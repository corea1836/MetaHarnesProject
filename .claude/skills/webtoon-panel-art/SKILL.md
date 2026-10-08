---
name: webtoon-panel-art
description: "웹툰 콘티(storyboard.json)의 패널을 OpenAI 이미지 API로 그린다. 설정집의 화풍·캐릭터 앵커와 기준 시트를 참조 이미지로 넘겨 일관성을 지키고, 생성한 패널을 체크리스트로 검수해 PASS/FIX/REDO를 판정한다. 패널 작화, 특정 컷 다시 그리기('3번 컷 표정만 다시'), 그림체 불일치 수정, 패널 검수 요청에 사용한다. 말풍선·대사 수정은 그림을 다시 그릴 필요가 없으므로 webtoon-lettering을 쓴다."
---

# 패널 작화와 검수

패널 하나를 그리는 일은 **프롬프트 조립 → 생성 → 자가 확인**이고, 검수자가 그 결과를 **판정**한다. 이 문서는 두 역할이 함께 쓴다. 검수 체크리스트는 `references/inspection-checklist.md`에 있다.

## 1. 프롬프트 조립

패널마다 `_workspace/05_artist_panels/{id}_v{n}.prompt.txt`에 아래 순서로 쓴다. 순서를 고정하는 이유는 재생성할 때 무엇을 바꿨는지 비교하기 쉽고, 검수자가 프롬프트와 결과를 항목별로 대조할 수 있기 때문이다.

```text
{bible.style.anchor}

Single webtoon panel, {shot} shot, {angle} angle, {가로/세로 구도: vertical or horizontal composition}.

Scene: {location anchor}. {panel.setting}

Characters:
- {label}: {character.anchor}. Wearing {outfits[outfit 또는 default]}. Expression: {expression}. Pose: {pose}.
  Match reference image {k} exactly: same face, hair, colors and distinctive marks.

Action: {panel.visual_prompt}

Composition: keep the {negative_space} area of the frame calm and uncluttered (plain wall, sky or soft background) — dialogue will be placed there later.

Reference images: image 1 is {label1}'s character sheet, image 2 is {label2}'s character sheet, the last image shows only the art style and color palette — do not copy its content.

Do not draw any text, letters, numbers, speech bubbles, captions, sound effects, signatures, watermarks, or panel borders. One single illustration, not a comic page.
```

- `{label}`은 설정집의 `alias_en`(예: "the boy with glasses")이다. 없을 때만 `id`를 쓴다. id는 원작 이름에서 따온 경우가 많아(팬아트·패러디), 프롬프트에 들어가면 정책 거부를 부르거나 원작 이미지 쪽으로 그림이 끌려간다. 같은 이유로 `visual_prompt`에 원작 고유명사가 섞여 있으면 프롬프트에 옮기기 전에 시각 묘사로 바꾸고 보고에 적는다.
- `negative_space`가 `none`이거나 없으면 Composition 줄을 뺀다.
- 인물이 없으면 Characters 줄을 빼고, 참조 이미지는 화풍 기준 이미지 하나만 넘긴다.
- **참조 이미지 순서**는 프롬프트에 적은 순서와 정확히 같아야 한다. 모델은 “image 1”을 첫 번째로 받은 파일로 해석한다.
- 이전 회차 검수에서 받은 `fix_prompt`가 있으면 `Action:` 다음 줄에 `Correction: ...`으로 덧붙인다.

## 2. 생성

```bash
node .claude/skills/webtoon-panel-art/scripts/generate_image.mjs \
  --prompt-file _workspace/05_artist_panels/p03_v1.prompt.txt \
  --out _workspace/05_artist_panels/p03_v1.png \
  --size 1024x1024 --quality high \
  --ref _workspace/03_designer_bible/refs/mina_ref.png \
  --ref _workspace/03_designer_bible/refs/style_ref.png
```

- `--size`는 콘티의 `size`를 그대로 쓴다. 합성 단계가 이 비율로 칸을 잡는다.
- `--quality`와 `--model`은 오케스트레이터가 지시한 값을 쓴다. 지시가 없으면 `high`와 기본 모델(`.env`의 `OPENAI_IMAGE_MODEL`, 없으면 `gpt-image-2.5-flare`)을 쓴다.
- 이미지 하나에 1~2분 걸릴 수 있다. Bash 시간 제한을 300000ms 이상으로 둔다. 맡은 패널이 여러 개면 Bash 호출을 한 메시지에 묶어 병렬로 실행해도 된다(최대 4개).
- 파일 이름은 `{id}_v{n}.png`이다. 다시 그릴 때는 **기존 파일을 덮어쓰지 않고** n을 올린다. 이전 시도와 비교해야 하고, 검수에서 이전 버전이 더 나았다고 판단할 수도 있기 때문이다.
- 오케스트레이터가 `--dry-run`을 지시하면 붙인다. API를 부르지 않고 자리표시 이미지를 만든다(시험 실행용).

### 종료 코드별 대응

| 코드 | 의미 | 대응 |
|------|------|------|
| 0 | 성공 | 자가 확인으로 넘어간다 |
| 1 | 인자 오류 | 메시지를 읽고 인자를 고쳐 다시 실행한다 |
| 2 | 키 없음·인증·결제·권한 | **재시도하지 않는다.** 다른 패널도 똑같이 실패하므로 즉시 작업을 멈추고 메시지를 그대로 보고한다 |
| 3 | 콘텐츠 정책 거부 | 같은 프롬프트로 재시도하지 않는다. 폭력·노출·실존 인물로 오해될 표현을 완화해 한 번만 다시 시도하고, 또 거부되면 BLOCKED로 보고한다 |
| 4 | 한도·서버 오류가 자동 재시도 후에도 지속 | 한 번만 다시 실행한다. 또 실패하면 FAILED로 보고한다 |

## 3. 자가 확인

생성한 이미지를 Read로 직접 열어 본다. 아래처럼 **명백한 실패**면 검수로 넘기기 전에 프롬프트를 고쳐 한 번 다시 그린다. 미묘한 품질 판단은 검수자에게 맡긴다.

- 등장해야 할 인물 수가 다르다.
- 글자·말풍선이 그려졌다.
- 실사풍처럼 화풍이 완전히 다르다.

## 4. 수정 방식: FIX와 REDO

검수자는 패널마다 PASS, FIX, REDO 가운데 하나로 판정한다.

**REDO**: 구도·인물·장면이 근본적으로 틀렸다. 프롬프트를 `fix_prompt`에 따라 고쳐 **처음부터** 다시 생성한다. 참조 이미지는 그대로다.

**FIX**: 대체로 맞지만 국소적인 문제(옷 색, 고유 표식 누락, 표정)가 있다. **현재 패널 이미지를 첫 번째 참조로 넣고** 수정 지시만 담은 짧은 프롬프트로 편집한다. 구도를 유지한 채 고칠 수 있다. 편집 정밀도가 중요하므로 `--model gpt-image-2.5-sunburst`를 쓴다.

```text
Edit image 1 (the current panel). Keep the composition, background, pose and art style exactly the same.
Change only: {fix_prompt}.
Images 2+ are character reference sheets — use them to correct {id}'s appearance.
Do not add any text, letters or speech bubbles.
```

## 5. 보고 형식

맡은 패널을 모두 마치면 다음 JSON을 응답 마지막에 코드 블록으로 남긴다. 오케스트레이터가 이 값으로 검수를 배정한다.

```json
{ "agent": "artist-1", "round": 1, "panels": [
  { "id": "p03", "status": "DONE", "file": "_workspace/05_artist_panels/p03_v1.png", "prompt": "_workspace/05_artist_panels/p03_v1.prompt.txt", "note": "" },
  { "id": "p04", "status": "BLOCKED", "file": null, "prompt": "_workspace/05_artist_panels/p04_v2.prompt.txt", "note": "정책 거부 2회: 칼을 든 장면" }
] }
```

`status`: `DONE` 생성 완료 · `BLOCKED` 정책 거부 · `FAILED` 일시 오류 지속 · `HALTED` 종료 코드 2로 전체 중단
