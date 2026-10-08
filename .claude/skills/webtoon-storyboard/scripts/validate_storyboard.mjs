#!/usr/bin/env node
// 콘티(storyboard.json)와 설정집(bible.json)이 하네스의 데이터 규약을 지키는지 검사한다.
// 작화·합성 단계는 이 규약을 그대로 믿고 동작하므로, 콘티를 넘기기 전에 반드시 통과시킨다.
//
// 사용법:
//   node validate_storyboard.mjs <storyboard.json> [--bible <bible.json>] [--expect 8-12]
//   node validate_storyboard.mjs --bible-only <bible.json>
// 출력: stdout에 JSON { ok, errors[], warnings[], stats }. 오류가 있으면 종료 코드 1.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SHOTS = ['establishing', 'wide', 'full', 'medium', 'close-up', 'extreme-close-up', 'insert']
const ANGLES = ['eye-level', 'high', 'low', 'bird', 'worm', 'dutch', 'over-shoulder', 'pov']
const SPACES = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right', 'none']
const BALLOONS = ['speech', 'thought', 'shout', 'whisper', 'electronic', 'narration']
const PLACEMENTS = ['over', 'gutter-before', 'gutter-after']
const TAILS = ['none', 'top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right', 'left', 'right']
const SFX_SIZES = ['s', 'm', 'l', 'xl']
const NEEDS_SPEAKER = ['speech', 'thought', 'shout', 'whisper', 'electronic']

const errors = [], warnings = []
const err = (where, msg) => errors.push({ where, msg })
const warn = (where, msg) => warnings.push({ where, msg })
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const hasHangul = s => /[가-힣]/.test(s ?? '')

function readJson(p, label) {
  if (!existsSync(p)) { err(label, `파일이 없다: ${p}`); return null }
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { err(label, `JSON 파싱 실패: ${e.message}`); return null }
}

function sizeError(size) {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '')
  if (!m) return `size는 WIDTHxHEIGHT 문자열이어야 한다: ${size}`
  const w = +m[1], h = +m[2]
  if (w % 16 || h % 16) return `가로·세로는 16의 배수여야 한다: ${size}`
  if (w / h > 3 || h / w > 3) return `비율은 1:3~3:1 사이여야 한다: ${size}`
  if (Math.max(w, h) > 3840) return `긴 변은 3840 이하여야 한다: ${size}`
  if (w * h < 655_360 || w * h > 8_294_400) return `총 픽셀이 API 허용 범위(655,360~8,294,400) 밖이다: ${size}`
  return null
}

function checkBible(bible, biblePath) {
  if (!bible) return new Set()
  const base = dirname(resolve(biblePath))
  if (!bible.style?.anchor || bible.style.anchor.length < 40) err('bible.style.anchor', '화풍 앵커는 40자 이상의 영어 묘사여야 한다')
  if (!Array.isArray(bible.characters) || !bible.characters.length) { err('bible.characters', '캐릭터가 한 명 이상 있어야 한다'); return new Set() }
  const ids = new Set()
  for (const [i, c] of bible.characters.entries()) {
    const w = `bible.characters[${i}]${c?.id ? `(${c.id})` : ''}`
    if (!/^[a-z][a-z0-9_]*$/.test(c?.id ?? '')) err(w, 'id는 영문 소문자로 시작하는 snake_case여야 한다')
    else if (ids.has(c.id)) err(w, `중복 id: ${c.id}`)
    else ids.add(c.id)
    if (!c?.name) err(w, 'name(표시 이름)이 없다')
    if (!c?.anchor || c.anchor.length < 60) err(w, '외형 앵커(anchor)는 60자 이상의 영어 묘사여야 한다')
    if (hasHangul(c?.anchor)) warn(w, 'anchor에 한글이 있다. 이미지 모델이 글자로 그릴 수 있으니 영어로 쓴다')
    if (!c?.ref) warn(w, '기준 시트 이미지(ref)가 아직 없다')
    else if (!existsSync(resolve(base, c.ref))) warn(w, `ref 파일이 없다: ${c.ref}`)
  }
  for (const [i, l] of (bible.locations ?? []).entries()) {
    if (!l?.id || !l?.anchor) warn(`bible.locations[${i}]`, '장소에는 id와 anchor가 있어야 한다')
  }
  return ids
}

function checkStoryboard(sb, charIds, expect) {
  if (!sb) return
  if (!sb.title) err('storyboard', 'title이 없다')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sb.slug ?? '')) err('storyboard', 'slug는 영문 소문자·숫자·하이픈이어야 한다(폴더 이름으로 쓴다)')
  if (!Array.isArray(sb.panels) || !sb.panels.length) { err('storyboard.panels', '패널이 하나 이상 있어야 한다'); return }

  const ids = new Set()
  for (const [i, p] of sb.panels.entries()) {
    const w = p?.id ?? `panels[${i}]`
    if (!/^p\d{2,3}$/.test(p?.id ?? '')) err(w, 'id는 p01, p02 … 형식이어야 한다')
    else if (ids.has(p.id)) err(w, `중복 id: ${p.id}`)
    else ids.add(p.id)
    const kind = p.kind ?? 'art'
    if (!['art', 'card'].includes(kind)) err(w, `kind는 art 또는 card여야 한다: ${kind}`)
    if (p.gap_before !== undefined && !(Number.isInteger(p.gap_before) && p.gap_before >= 0 && p.gap_before <= 2000))
      err(w, 'gap_before는 0~2000 사이 정수(px)여야 한다')

    if (kind === 'card') {
      if (!p.card || typeof p.card !== 'object') { err(w, 'card 패널에는 card 객체가 있어야 한다'); continue }
      if (p.card.height !== undefined && !isNum(p.card.height, 100, 2000)) err(w, 'card.height는 100~2000이어야 한다')
      continue
    }

    const se = sizeError(p.size)
    if (se) err(w, se)
    if (!SHOTS.includes(p.shot)) err(w, `shot은 ${SHOTS.join('|')} 중 하나여야 한다: ${p.shot}`)
    if (!ANGLES.includes(p.angle)) err(w, `angle은 ${ANGLES.join('|')} 중 하나여야 한다: ${p.angle}`)
    if (!p.beat) warn(w, 'beat(이 컷의 한 줄 요약)가 없다')
    if (!p.visual_prompt || p.visual_prompt.length < 20) err(w, 'visual_prompt는 20자 이상의 영어 묘사여야 한다')
    if (hasHangul(p.visual_prompt) || hasHangul(p.setting)) warn(w, 'visual_prompt/setting에 한글이 있다. 이미지에 글자가 그려질 수 있으니 영어로 쓴다')
    if (/\b(speech bubble|caption|lettering|written text)\b/i.test(p.visual_prompt ?? '') && !/\bno (text|speech bubble|caption|lettering)/i.test(p.visual_prompt ?? ''))
      warn(w, 'visual_prompt가 말풍선·글자를 그리라고 읽힐 수 있다. 글자는 합성 단계에서 넣는다')
    if (p.negative_space !== undefined && !SPACES.includes(p.negative_space)) err(w, `negative_space는 ${SPACES.join('|')} 중 하나여야 한다`)

    const present = new Set()
    if (!Array.isArray(p.characters)) err(w, 'characters는 배열이어야 한다(인물이 없으면 [])')
    else for (const c of p.characters) {
      if (!c?.id) { err(w, 'characters 항목에 id가 없다'); continue }
      present.add(c.id)
      if (charIds.size && !charIds.has(c.id)) err(w, `설정집에 없는 캐릭터: ${c.id}`)
      if (!c.expression) warn(w, `${c.id}의 expression이 없다`)
    }
    if ((p.characters?.length ?? 0) > 4) warn(w, '한 컷에 인물이 4명을 넘으면 얼굴 일관성이 크게 떨어진다')

    const balloons = p.balloons ?? []
    if (!Array.isArray(balloons)) { err(w, 'balloons는 배열이어야 한다'); continue }
    let over = 0, chars = 0
    for (const [j, b] of balloons.entries()) {
      const bw = `${w}.balloons[${j}]`
      if (!BALLOONS.includes(b?.type)) err(bw, `type은 ${BALLOONS.join('|')} 중 하나여야 한다`)
      if (!b?.text?.trim()) err(bw, 'text가 비어 있다')
      chars += (b?.text ?? '').length
      if ((b?.text ?? '').length > 40) warn(bw, `말풍선 하나에 ${b.text.length}자다. 40자 이하로 나누면 읽기 쉽다`)
      if (!PLACEMENTS.includes(b?.placement)) err(bw, `placement는 ${PLACEMENTS.join('|')} 중 하나여야 한다`)
      if (b?.tail !== undefined && !TAILS.includes(b.tail)) err(bw, `tail은 ${TAILS.join('|')} 중 하나여야 한다`)
      if (NEEDS_SPEAKER.includes(b?.type)) {
        if (!b.speaker) err(bw, `${b.type} 말풍선에는 speaker가 필요하다`)
        else if (!b.speaker.startsWith('extra:')) {
          if (charIds.size && !charIds.has(b.speaker)) err(bw, `설정집에 없는 화자: ${b.speaker} (단역은 extra:이름)`)
          else if (!present.has(b.speaker) && b.tail && b.tail !== 'none') warn(bw, `${b.speaker}가 컷에 없는데 꼬리가 있다. 화면 밖 목소리면 tail을 none으로 둔다`)
        }
      }
      if (b?.placement === 'over') {
        over++
        if (!isNum(b.x, 0, 100) || !isNum(b.y, 0, 100)) err(bw, 'over 말풍선의 x, y는 패널 기준 0~100(%)이어야 한다')
        if (!isNum(b.w, 10, 90)) err(bw, 'over 말풍선의 w는 10~90(%)이어야 한다')
        else if (isNum(b.x, 0, 100) && b.x + b.w > 100) err(bw, `x + w가 100을 넘는다(${b.x}+${b.w})`)
      }
    }
    if (balloons.length > 3) warn(w, `말풍선이 ${balloons.length}개다. 한 컷에 3개를 넘기면 그림이 가려진다`)
    if (chars > 90) warn(w, `대사 총 ${chars}자다. 컷을 나누는 편이 읽기 쉽다`)
    if (over && (!p.negative_space || p.negative_space === 'none')) warn(w, '그림 위 말풍선이 있는데 negative_space가 없다. 작화가 말풍선 자리를 비워 두지 못한다')

    for (const [j, s] of (p.sfx ?? []).entries()) {
      const sw = `${w}.sfx[${j}]`
      if (!s?.text) err(sw, 'text가 비어 있다')
      if (!isNum(s?.x, 0, 100) || !isNum(s?.y, 0, 100)) err(sw, 'x, y는 0~100(%)이어야 한다')
      if (s?.size !== undefined && !SFX_SIZES.includes(s.size)) err(sw, `size는 ${SFX_SIZES.join('|')} 중 하나여야 한다`)
      if (s?.rotate !== undefined && !isNum(s.rotate, -45, 45)) err(sw, 'rotate는 -45~45도여야 한다')
    }
  }

  const art = sb.panels.filter(p => (p.kind ?? 'art') === 'art').length
  if (expect) {
    const [lo, hi] = expect
    if (art < lo || art > hi) warn('storyboard', `그림 컷이 ${art}개다. 요청 분량(${lo}~${hi}컷)을 벗어난다`)
  }
  return art
}

const argv = process.argv.slice(2)
let sbPath, biblePath, expect = null, bibleOnly = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--bible') biblePath = argv[++i]
  else if (argv[i] === '--bible-only') { bibleOnly = true; biblePath = argv[++i] }
  else if (argv[i] === '--expect') {
    const m = /^(\d+)-(\d+)$/.exec(argv[++i] ?? '')
    if (m) expect = [+m[1], +m[2]]
  } else sbPath = argv[i]
}
if (!bibleOnly && !sbPath) {
  console.error('사용법: node validate_storyboard.mjs <storyboard.json> [--bible <bible.json>] [--expect 8-12] | --bible-only <bible.json>')
  process.exit(1)
}

const bible = biblePath ? readJson(biblePath, 'bible') : null
const charIds = checkBible(bible, biblePath)
let stats = { characters: [...charIds] }
if (!bibleOnly) {
  const sb = readJson(sbPath, 'storyboard')
  const art = checkStoryboard(sb, charIds, expect)
  if (sb?.panels) stats = {
    ...stats,
    panels: sb.panels.length,
    art_panels: art,
    card_panels: sb.panels.length - (art ?? 0),
    balloons: sb.panels.reduce((n, p) => n + (p.balloons?.length ?? 0), 0),
  }
}
console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings, stats }, null, 2))
process.exit(errors.length ? 1 : 0)
