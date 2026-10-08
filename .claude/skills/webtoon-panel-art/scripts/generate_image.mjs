#!/usr/bin/env node
// OpenAI 이미지 API로 웹툰 패널·캐릭터 기준 시트를 생성한다. 외부 패키지 없이 Node 18+ 내장 fetch/FormData만 쓴다.
//
// 사용법:
//   node generate_image.mjs --prompt-file <txt> --out <png> [--size 1024x1536] [--quality high]
//        [--model gpt-image-2.5-flare] [--ref a.png --ref b.png ...] [--param key=value ...] [--dry-run]
//   node generate_image.mjs --check            # 키와 모델 접근 권한만 확인(이미지 비용 없음)
//
// --ref가 있으면 /v1/images/edits(참조 이미지 입력), 없으면 /v1/images/generations를 호출한다.
// 결과 이미지 옆에 <out>.meta.json(모델·크기·참조·사용량)을 남긴다.
//
// 종료 코드 — 에이전트는 이 값으로 재시도 여부를 판단한다.
//   0 성공
//   1 인자·요청 형식 오류(프롬프트 파일 없음, 잘못된 size 등) → 인자를 고쳐 다시 실행
//   2 설정·인증·권한·결제 오류(키 없음, 401/403, insufficient_quota) → 재시도 금지, 사용자에게 보고
//   3 콘텐츠 정책 거부 → 같은 프롬프트로 재시도 금지, 표현을 바꿔 다시 실행
//   4 일시 오류(429 한도, 5xx, 네트워크)가 자동 재시도 후에도 계속됨 → 잠시 뒤 한 번만 다시 실행

import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const API = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-image-2.5-flare'
const TIMEOUT_MS = 300_000
const BACKOFF_MS = [5_000, 20_000, 60_000]

function fail(code, msg) {
  console.error(`[generate_image] ${msg}`)
  process.exit(code)
}

function parseArgs(argv) {
  const a = { refs: [], params: {}, size: '1024x1536', quality: 'high', dryRun: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = () => {
      const val = argv[++i]
      if (val === undefined) fail(1, `${k} 뒤에 값이 없다`)
      return val
    }
    if (k === '--prompt-file') a.promptFile = v()
    else if (k === '--out') a.out = v()
    else if (k === '--size') a.size = v()
    else if (k === '--quality') a.quality = v()
    else if (k === '--model') a.model = v()
    else if (k === '--ref') a.refs.push(v())
    else if (k === '--param') {
      const [pk, ...rest] = v().split('=')
      a.params[pk] = rest.join('=')
    } else if (k === '--dry-run') a.dryRun = true
    else if (k === '--check') a.check = true
    else fail(1, `알 수 없는 인자: ${k}`)
  }
  return a
}

// 현재 디렉터리부터 위로 올라가며 처음 만나는 .env를 읽는다. 이미 설정된 환경 변수는 덮어쓰지 않는다.
function loadDotEnv() {
  let dir = process.cwd()
  while (true) {
    const p = join(dir, '.env')
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (!m || process.env[m[1]] !== undefined) continue
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
      }
      return p
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// API 제약: 16의 배수, 비율 1:3~3:1, 긴 변 3840 이하, 총 픽셀 655,360~8,294,400
function validateSize(size) {
  if (size === 'auto') return null
  const m = /^(\d+)x(\d+)$/.exec(size)
  if (!m) return `size 형식은 WIDTHxHEIGHT여야 한다: ${size}`
  const w = +m[1], h = +m[2]
  if (w % 16 || h % 16) return `가로·세로는 16의 배수여야 한다: ${size}`
  if (w / h > 3 || h / w > 3) return `비율은 1:3~3:1 사이여야 한다: ${size}`
  if (Math.max(w, h) > 3840) return `긴 변은 3840 이하여야 한다: ${size}`
  if (w * h < 655_360 || w * h > 8_294_400) return `총 픽셀은 655,360~8,294,400 사이여야 한다: ${size} (${w * h})`
  return null
}

function mimeOf(p) {
  const e = extname(p).toLowerCase()
  return e === '.jpg' || e === '.jpeg' ? 'image/jpeg' : e === '.webp' ? 'image/webp' : 'image/png'
}

function classify(status, body) {
  const err = body?.error ?? {}
  const text = `${err.code ?? ''} ${err.type ?? ''} ${err.message ?? ''}`.toLowerCase()
  if (status === 401 || status === 403) return 2
  if (text.includes('insufficient_quota') || text.includes('billing')) return 2
  if (text.includes('moderation') || text.includes('safety') || text.includes('content_policy')) return 3
  if (status === 429 || status >= 500) return 4
  if (status === 404 && text.includes('model')) return 2
  return 1
}

async function callApi(path, init) {
  let last
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await res.json().catch(() => ({}))
      if (res.ok) return body
      const code = classify(res.status, body)
      last = { code, msg: `HTTP ${res.status}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 300)}` }
      if (code !== 4) break
    } catch (e) {
      last = { code: 4, msg: `네트워크 오류: ${e.message}` }
    }
    if (attempt < BACKOFF_MS.length) {
      console.error(`[generate_image] 일시 오류, ${BACKOFF_MS[attempt] / 1000}초 뒤 재시도: ${last.msg}`)
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]))
    }
  }
  fail(last.code, last.msg)
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  return candidates.find(p => existsSync(p))
}

// API 키 없이 파이프라인 전체를 시험할 수 있도록, 요청한 크기의 자리표시 PNG를 Chrome으로 그린다.
async function dryRun(a, prompt) {
  const [w, h] = a.size === 'auto' ? [1024, 1536] : a.size.split('x').map(Number)
  const chrome = chromePath()
  if (!chrome) fail(2, 'dry-run에는 Chrome이 필요하다. CHROME_PATH를 설정하라')
  const tmp = await mkdtemp(join(tmpdir(), 'webtoon-dry-'))
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}body{width:${w}px;height:${h}px;
    background:repeating-linear-gradient(45deg,#e8eef7 0 24px,#dde6f2 24px 48px);font:22px/1.45 "Apple SD Gothic Neo",sans-serif;
    display:flex;align-items:center;justify-content:center}div{width:80%;background:#fffd;border:3px dashed #678;padding:28px;
    max-height:80%;overflow:hidden}b{font-size:34px;display:block;margin-bottom:12px}</style>
    <div><b>DRY-RUN ${esc(basename(a.out))} · ${w}x${h}</b>refs: ${a.refs.length}<br>${esc(prompt.slice(0, 900))}</div>`
  const htmlPath = join(tmp, 'p.html')
  await writeFile(htmlPath, html)
  // --user-data-dir를 주면 Chrome이 스크린샷 뒤에도 종료하지 않는 경우가 있어 넣지 않는다(헤드리스는 임시 프로필을 쓴다).
  await run(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=2000', `--window-size=${w},${h}`, `--screenshot=${resolve(a.out)}`, `file://${htmlPath}`],
    { timeout: 60_000 }).catch(e => { if (!existsSync(a.out)) throw e })
  await rm(tmp, { recursive: true, force: true })
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const envFile = loadDotEnv()
  // .env.example을 그대로 복사해 값이 빈 줄이 있어도 기본값을 쓰도록 ??가 아니라 ||로 고른다.
  const model = a.model || process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL
  const key = process.env.OPENAI_API_KEY

  if (a.check) {
    if (!key) fail(2, `OPENAI_API_KEY가 없다. 프로젝트 루트 .env에 넣어라 (읽은 .env: ${envFile ?? '없음'})`)
    await callApi(`/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` } })
    console.log(JSON.stringify({ ok: true, model, env: envFile }))
    return
  }

  if (!a.promptFile || !a.out) fail(1, '--prompt-file과 --out은 필수다')
  if (!existsSync(a.promptFile)) fail(1, `프롬프트 파일이 없다: ${a.promptFile}`)
  const sizeErr = validateSize(a.size)
  if (sizeErr) fail(1, sizeErr)
  for (const r of a.refs) if (!existsSync(r)) fail(1, `참조 이미지가 없다: ${r}`)
  const prompt = (await readFile(a.promptFile, 'utf8')).trim()
  if (!prompt) fail(1, '프롬프트가 비어 있다')
  await mkdir(dirname(resolve(a.out)), { recursive: true })

  let usage = null
  if (a.dryRun) {
    await dryRun(a, prompt)
  } else {
    if (!key) fail(2, `OPENAI_API_KEY가 없다. 프로젝트 루트 .env에 넣어라 (읽은 .env: ${envFile ?? '없음'})`)
    let body
    if (a.refs.length) {
      const fd = new FormData()
      fd.append('model', model)
      fd.append('prompt', prompt)
      fd.append('size', a.size)
      fd.append('quality', a.quality)
      fd.append('n', '1')
      for (const [k, v] of Object.entries(a.params)) fd.append(k, v)
      for (const r of a.refs) fd.append('image[]', new Blob([await readFile(r)], { type: mimeOf(r) }), basename(r))
      body = await callApi('/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd })
    } else {
      body = await callApi('/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size: a.size, quality: a.quality, n: 1, ...a.params }),
      })
    }
    const b64 = body?.data?.[0]?.b64_json
    if (!b64) fail(4, `응답에 이미지가 없다: ${JSON.stringify(body).slice(0, 300)}`)
    await writeFile(a.out, Buffer.from(b64, 'base64'))
    usage = body.usage ?? null
  }

  const meta = {
    out: a.out, model: a.dryRun ? 'dry-run' : model, size: a.size, quality: a.quality,
    endpoint: a.dryRun ? null : a.refs.length ? 'edits' : 'generations',
    refs: a.refs, params: a.params, prompt_file: a.promptFile, usage,
  }
  await writeFile(`${a.out}.meta.json`, JSON.stringify(meta, null, 2))
  console.log(JSON.stringify({ ok: true, out: a.out, model: meta.model, size: a.size, refs: a.refs.length }))
}

main().catch(e => fail(4, e.stack ?? String(e)))
