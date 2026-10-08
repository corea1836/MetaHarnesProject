#!/usr/bin/env node
// 식자·합성: 콘티(storyboard.json)와 패널 이미지로 세로 스크롤 웹툰을 만든다.
// 글자(대사·내레이션·효과음)는 이미지 모델에 맡기지 않고 HTML/CSS로 얹는다. 이미지 모델은 한글을 정확히 그리지 못하고,
// 대사를 고칠 때마다 그림을 다시 생성하면 비용과 일관성을 모두 잃기 때문이다.
//
// 사용법:
//   node compose_episode.mjs --storyboard <json> --panels <dir> --out <dir>
//        [--select <json>] [--width 800] [--slice 1280] [--split fixed|panels|none] [--strips-dir strips]
//        [--max-gap <px>] [--html-only] [--allow-missing]
//
// 패널 이미지 찾는 순서: --select 매핑({"p01": "p01_v2.png"}) → <id>.png|webp|jpg → 가장 높은 <id>_v<n>.*
// 조각 나누기(--split):
//   fixed  (기본) --slice 높이마다 자른다. 플랫폼 업로드 규격용. 칸·말풍선이 조각 경계에서 잘릴 수 있다.
//   panels 칸 경계에서 자른다. 조각 하나 = 칸 하나(+그 칸의 여백 말풍선, 다음 칸 앞 여백). 첫 조각이 곧 첫 컷이라
//          커뮤니티 썸네일과 이미지를 한 장씩 넘기는 SNS에 맞다. --slice를 넘는 칸이 있으면 경고만 한다.
//   none   전체를 한 장으로. 커뮤니티 본문 게시용.
// --max-gap: 이번 PNG 출력에서만 칸 사이 여백을 이 높이(px)로 줄인다. 이어 읽을 때의 뜸(리빌 여백)이 한 장씩 보는
//   SNS 조각에서는 빈 화면이 되기 때문이다. episode.html 뷰어와 콘티는 바뀌지 않는다.
// 산출물: <out>/episode.html(브라우저 뷰어), <out>/panels/, <out>/<strips-dir>/strip_001.png …,
//         <out>/layout.json(총 높이·조각 경계·누락 패널)
// 종료 코드: 0 성공 / 1 입력 오류 또는 패널 누락(--allow-missing 없이) / 2 Chrome 없음·렌더링 실패

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const IMG_EXT = ['.png', '.webp', '.jpg', '.jpeg']

function fail(code, msg) {
  console.error(`[compose_episode] ${msg}`)
  process.exit(code)
}

function parseArgs(argv) {
  const a = { width: 800, slice: 1280, split: 'fixed', stripsDir: 'strips', maxGap: null, htmlOnly: false, allowMissing: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = () => argv[++i]
    if (k === '--storyboard') a.storyboard = v()
    else if (k === '--panels') a.panels = v()
    else if (k === '--out') a.out = v()
    else if (k === '--select') a.select = v()
    else if (k === '--width') a.width = +v()
    else if (k === '--slice') a.slice = +v()
    else if (k === '--split') a.split = v()
    else if (k === '--strips-dir') a.stripsDir = v()
    else if (k === '--max-gap') a.maxGap = +v()
    else if (k === '--html-only') a.htmlOnly = true
    else if (k === '--allow-missing') a.allowMissing = true
    else fail(1, `알 수 없는 인자: ${k}`)
  }
  if (!a.storyboard || !a.panels || !a.out) fail(1, '--storyboard, --panels, --out은 필수다')
  if (!['fixed', 'panels', 'none'].includes(a.split)) fail(1, `--split은 fixed, panels, none 중 하나다: ${a.split}`)
  return a
}

function resolvePanel(id, dir, select) {
  if (select?.[id]) {
    const p = join(dir, select[id])
    return existsSync(p) ? p : null
  }
  for (const e of IMG_EXT) if (existsSync(join(dir, `${id}${e}`))) return join(dir, `${id}${e}`)
  const re = new RegExp(`^${id}_v(\\d+)(\\.png|\\.webp|\\.jpe?g)$`)
  const versions = readdirSync(dir).map(f => [f, re.exec(f)]).filter(([, m]) => m).sort((x, y) => +y[1][1] - +x[1][1])
  return versions.length ? join(dir, versions[0][0]) : null
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const text = s => esc(s).replace(/\n/g, '<br>')
// 콘티의 px 값은 가로 800px 기준이다. cqw로 바꿔 두면 좁은 화면의 뷰어에서도 비율이 유지된다.
const cq = (px, width) => `${+(px / (width / 100)).toFixed(3)}cqw`

function balloonHtml(b, inGutter) {
  const tail = b.tail && b.tail !== 'none' && b.type !== 'narration' ? ` t-${b.tail}` : ''
  const plain = inGutter && b.type === 'narration' ? ' plain' : ''
  const style = inGutter
    ? (b.w ? `max-width:${b.w}%` : '')
    : `left:${b.x}%;top:${b.y}%;width:${b.w}%`
  return `<div class="b ${esc(b.type)}${tail}${plain}" style="${style}">${text(b.text)}</div>`
}

function gutterRow(balloons, gutter) {
  if (!balloons.length) return ''
  const items = balloons.map(b => {
    const align = b.align ?? (b.x === undefined ? 'center' : b.x < 34 ? 'left' : b.x > 50 ? 'right' : 'center')
    return `<div class="gb ${esc(align)}">${balloonHtml(b, true)}</div>`
  }).join('')
  return `<div class="gutter" style="background:${esc(gutter)}">${items}</div>`
}

function buildHtml(sb, files, width) {
  const parts = []
  for (const p of sb.panels) {
    const gutter = p.gutter_color ?? '#ffffff'
    const gap = p.gap_before ?? 60
    if (gap) parts.push(`<div class="gap" style="height:${cq(gap, width)};background:${esc(gutter)}"></div>`)
    // 칸의 내용(여백 말풍선 + 그림 + 여백 말풍선)을 .unit으로 묶는다. --split panels는 .unit의 시작 위치에서 자른다.
    // 앞 여백은 .unit 밖에 두어 이전 조각의 끝에 붙게 한다. 리빌용 여백이 스크롤 뜸으로 남고, 조각이 빈 공간으로 시작하지 않는다.
    if ((p.kind ?? 'art') === 'card') {
      const c = p.card ?? {}
      parts.push(`<div class="unit" data-id="${esc(p.id)}"><section class="card" style="height:${cq(c.height ?? 480, width)};background:${esc(c.bg ?? '#ffffff')};color:${esc(c.color ?? '#111111')}"><div>${text(c.text ?? '')}</div></section></div>`)
      continue
    }
    const balloons = p.balloons ?? []
    const [w, h] = p.size.split('x').map(Number)
    const img = files[p.id]
      ? `<img src="panels/${esc(files[p.id])}" alt="${esc(p.beat ?? p.id)}">`
      : `<div class="missing">${esc(p.id)} 이미지 없음</div>`
    const over = balloons.filter(b => b.placement === 'over').map(b => balloonHtml(b, false)).join('')
    const sfx = (p.sfx ?? []).map(s =>
      `<div class="sfx ${esc(s.size ?? 'm')}" style="left:${s.x}%;top:${s.y}%;color:${esc(s.color ?? '#111')};transform:translate(-50%,-50%) rotate(${s.rotate ?? 0}deg)">${text(s.text)}</div>`).join('')
    parts.push(`<div class="unit" data-id="${esc(p.id)}">`
      + gutterRow(balloons.filter(b => b.placement === 'gutter-before'), gutter)
      + `<figure class="panel ${esc(p.frame ?? 'bleed')}" data-id="${esc(p.id)}" style="aspect-ratio:${w}/${h}">${img}${sfx}${over}</figure>`
      + gutterRow(balloons.filter(b => b.placement === 'gutter-after'), gutter)
      + `</div>`)
  }
  parts.push(`<div class="gap" style="height:${cq(160, width)}"></div>`)

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(sb.title)}${sb.episode ? ` ${esc(sb.episode)}화` : ''}</title>
<style>
:root{--ink:#111;--font:"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif}
html,body{margin:0}
body{background:#2a2a2e;font-family:var(--font);color:var(--ink)}
header{max-width:${width}px;margin:0 auto;padding:28px 16px 20px;color:#eee}
header h1{margin:0 0 6px;font-size:24px} header p{margin:0;color:#aaa;font-size:14px;line-height:1.5}
#strip{container-type:inline-size;width:100%;max-width:${width}px;margin:0 auto 40px;background:#fff;overflow:hidden}
.export body,.export{background:#fff}
.export header{display:none}
.export #strip{width:${width}px;max-width:none;margin:0}
.gap{width:100%}
.card{display:flex;align-items:center;justify-content:center;text-align:center;font-size:4.2cqw;font-weight:700;line-height:1.5;padding:0 8cqw;box-sizing:border-box}
.panel{position:relative;margin:0;width:100%;overflow:hidden;background:#ddd}
.panel.framed{width:calc(100% - 6cqw);margin:0 3cqw;border:.4cqw solid var(--ink);box-sizing:border-box}
.panel img{display:block;width:100%;height:100%;object-fit:cover}
.missing{display:flex;height:100%;align-items:center;justify-content:center;font-size:5cqw;color:#a00;background:repeating-linear-gradient(45deg,#fee 0 2cqw,#fdd 2cqw 4cqw)}
.gutter{display:flex;flex-direction:column;gap:1.6cqw;padding:2.2cqw 5cqw}
.gb{display:flex}.gb.left{justify-content:flex-start}.gb.center{justify-content:center}.gb.right{justify-content:flex-end}
.gb .b{position:relative;max-width:70%}
.b{position:absolute;box-sizing:border-box;background:#fff;border:.38cqw solid var(--ink);border-radius:999px;padding:1.5cqw 3cqw;
  font-size:3.1cqw;font-weight:700;line-height:1.38;text-align:center;word-break:keep-all;overflow-wrap:anywhere;z-index:2}
.b::after{content:"";position:absolute;width:2.4cqw;height:2.4cqw;background:inherit;border:inherit;border-width:0;transform:rotate(45deg)}
.b.t-bottom::after,.b.t-bottom-left::after,.b.t-bottom-right::after{bottom:-1.3cqw;border-right-width:.38cqw;border-bottom-width:.38cqw}
.b.t-top::after,.b.t-top-left::after,.b.t-top-right::after{top:-1.3cqw;border-left-width:.38cqw;border-top-width:.38cqw}
.b.t-bottom::after,.b.t-top::after{left:calc(50% - 1.2cqw)}
.b.t-bottom-left::after,.b.t-top-left::after{left:20%}
.b.t-bottom-right::after,.b.t-top-right::after{right:20%}
.b.t-left::after{left:-1.3cqw;top:calc(50% - 1.2cqw);border-left-width:.38cqw;border-bottom-width:.38cqw}
.b.t-right::after{right:-1.3cqw;top:calc(50% - 1.2cqw);border-right-width:.38cqw;border-top-width:.38cqw}
.b.thought{border-style:dashed;border-radius:46%}
.b.thought::after{border-style:solid;border-width:.38cqw!important;border-radius:50%;width:1.8cqw;height:1.8cqw}
.b.thought.t-bottom::after,.b.thought.t-bottom-left::after,.b.thought.t-bottom-right::after{bottom:-3cqw}
.b.thought.t-top::after,.b.thought.t-top-left::after,.b.thought.t-top-right::after{top:-3cqw}
.b.thought.t-left::after{left:-3cqw}.b.thought.t-right::after{right:-3cqw}
.b.shout{border-width:.7cqw;border-radius:1.4cqw;font-size:3.9cqw;font-weight:900;letter-spacing:-.02em;transform:rotate(-1.5deg)}
.b.shout::after{border-color:var(--ink)}
.b.shout.t-bottom::after,.b.shout.t-bottom-left::after,.b.shout.t-bottom-right::after{border-right-width:.7cqw;border-bottom-width:.7cqw;bottom:-1.5cqw}
.b.shout.t-top::after,.b.shout.t-top-left::after,.b.shout.t-top-right::after{border-left-width:.7cqw;border-top-width:.7cqw;top:-1.5cqw}
.b.whisper{border-style:dashed;border-width:.28cqw;color:#555;font-weight:500;font-size:2.8cqw}
.b.electronic{background:#eef5ff;border-style:double;border-width:.8cqw;border-radius:1.6cqw}
.b.narration{background:#fffbea;border-width:.28cqw;border-radius:.6cqw;font-weight:500;text-align:left}
.b.narration.plain{background:transparent;border:0;text-align:center;font-weight:600;color:#333}
.sfx{position:absolute;font-weight:900;white-space:nowrap;line-height:1;-webkit-text-stroke:.7cqw #fff;paint-order:stroke fill;
  text-shadow:.4cqw .4cqw 0 rgba(0,0,0,.25);z-index:1}
.sfx.s{font-size:4.5cqw}.sfx.m{font-size:7cqw}.sfx.l{font-size:10cqw}.sfx.xl{font-size:14cqw}
</style></head>
<body>
<header><h1>${esc(sb.title)}${sb.episode ? ` · ${esc(sb.episode)}화` : ''}</h1>${sb.logline ? `<p>${esc(sb.logline)}</p>` : ''}</header>
<main id="strip">
${parts.filter(Boolean).join('\n')}
</main>
<script>
(function(){
  var h = location.hash
  if (h.indexOf('#export') === 0) document.documentElement.classList.add('export')
  var m = h.match(/[&#]y=(\\d+)/)
  if (m) document.getElementById('strip').style.marginTop = '-' + m[1] + 'px'
  var g = h.match(/[&#]maxgap=(\\d+)/)
  if (g) [].forEach.call(document.querySelectorAll('#strip .gap'), function(e){ e.style.maxHeight = g[1] + 'px' })
  window.addEventListener('load', function(){
    var strip = document.getElementById('strip'), top = strip.getBoundingClientRect().top
    var cuts = [].map.call(document.querySelectorAll('#strip .unit'), function(u){ return Math.round(u.getBoundingClientRect().top - top) })
    document.body.setAttribute('data-total-height', Math.ceil(strip.getBoundingClientRect().height))
    document.body.setAttribute('data-cuts', cuts.join(','))
  })
})()
</script>
</body></html>
`
}

function chromePath() {
  return [process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => existsSync(p))
}

// --user-data-dir를 주면 Chrome이 작업 뒤에도 종료하지 않는 경우가 있어 넣지 않는다(헤드리스는 실행마다 임시 프로필을 쓴다).
// 그래도 멈추면 시간 제한으로 끊고, 스크린샷 파일이 이미 생겼으면 성공으로 본다.
async function chrome(bin, args, expectFile) {
  const base = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=ffffffff', '--virtual-time-budget=5000']
  try {
    return await run(bin, [...base, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 })
  } catch (e) {
    if (expectFile && existsSync(expectFile)) return { stdout: '' }
    throw e
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!existsSync(a.storyboard)) fail(1, `콘티 파일이 없다: ${a.storyboard}`)
  if (!existsSync(a.panels)) fail(1, `패널 폴더가 없다: ${a.panels}`)
  const sb = JSON.parse(readFileSync(a.storyboard, 'utf8'))
  const select = a.select ? JSON.parse(readFileSync(a.select, 'utf8')) : null
  const out = resolve(a.out)
  await mkdir(join(out, 'panels'), { recursive: true })

  const files = {}, missing = []
  for (const p of sb.panels) {
    if ((p.kind ?? 'art') !== 'art') continue
    const src = resolvePanel(p.id, a.panels, select)
    if (!src) { missing.push(p.id); continue }
    const name = `${p.id}${extname(src).toLowerCase()}`
    await copyFile(src, join(out, 'panels', name))
    files[p.id] = name
  }
  if (missing.length && !a.allowMissing) fail(1, `패널 이미지가 없다: ${missing.join(', ')} (자리표시로 합성하려면 --allow-missing)`)

  const htmlPath = join(out, 'episode.html')
  await writeFile(htmlPath, buildHtml(sb, files, a.width))
  const result = { ok: true, html: htmlPath, missing, total_height: null, strips: [] }

  if (!a.htmlOnly) {
    const bin = chromePath()
    if (!bin) fail(2, 'Chrome을 찾지 못했다. CHROME_PATH를 설정하거나 --html-only로 실행하라')
    try {
      const url = `file://${htmlPath}`
      const gapArg = Number.isFinite(a.maxGap) ? `&maxgap=${a.maxGap}` : ''
      const { stdout } = await chrome(bin, [`--window-size=${a.width},${a.slice}`, '--dump-dom', `${url}#export${gapArg}`])
      const total = +(/data-total-height="(\d+)"/.exec(stdout)?.[1] ?? 0)
      if (!total) fail(2, '전체 높이를 재지 못했다. episode.html을 브라우저로 열어 오류를 확인하라')
      result.total_height = total
      // 조각 경계(시작 y 목록)를 정한다. 마지막 조각은 total까지다.
      let starts
      if (a.split === 'none') starts = [0]
      else if (a.split === 'panels') {
        const cuts = (/data-cuts="([\d,]*)"/.exec(stdout)?.[1] ?? '').split(',').filter(Boolean).map(Number)
        starts = [0, ...cuts.filter(c => c > 0)]
      } else starts = Array.from({ length: Math.ceil(total / a.slice) }, (_, i) => i * a.slice)
      const bounds = starts.map((y, i) => [y, (starts[i + 1] ?? total) - y])
      const tall = bounds.filter(([, h]) => h > a.slice).length
      if (a.split === 'panels' && tall) console.error(`[compose_episode] 경고: ${tall}개 조각이 --slice(${a.slice}px)보다 길다. 플랫폼 업로드 한도가 있으면 --split fixed로 따로 만들어라`)
      result.split = a.split
      result.max_gap = a.maxGap
      result.bounds = bounds
      const dir = join(out, a.stripsDir)
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      // 조각 하나에 1초 남짓이다. 프로필 없이 Chrome을 동시에 여러 개 띄우면 서로 막히므로 순서대로 찍는다.
      for (const [i, [y, h]] of bounds.entries()) {
        const file = join(dir, `strip_${String(i + 1).padStart(3, '0')}.png`)
        await chrome(bin, [`--window-size=${a.width},${h}`, `--screenshot=${file}`, `${url}#export${gapArg}&y=${y}`], file)
        result.strips[i] = file
      }
    } catch (e) {
      fail(2, `Chrome 렌더링 실패: ${e.message}`)
    }
  }

  const layoutName = a.stripsDir === 'strips' ? 'layout.json' : `layout_${a.stripsDir}.json`
  await writeFile(join(out, layoutName), JSON.stringify({ ...result, width: a.width, slice: a.slice, files }, null, 2))
  console.log(JSON.stringify({ ok: true, html: result.html, total_height: result.total_height, strips: result.strips.length, missing }))
}

main().catch(e => fail(2, e.stack ?? String(e)))
