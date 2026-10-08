---
name: webtoon-character-design
description: "웹툰 설정집(bible.json)을 만든다. 화풍 앵커, 캐릭터별 불변 외형 앵커와 의상, 반복 장소를 영어 묘사로 정하고, OpenAI 이미지 API로 캐릭터 기준 시트와 화풍 기준 이미지를 생성해 검수한다. 웹툰 캐릭터 디자인, 화풍 정하기, 캐릭터 외형 수정('머리를 단발로'), 새 캐릭터 추가, 이전 작품 설정집 재사용 요청에 사용한다. 개별 패널 그림 생성은 webtoon-panel-art가 맡는다."
---

# 웹툰 설정집과 기준 시트

AI로 웹툰을 그릴 때 가장 먼저 무너지는 것은 **컷마다 같은 인물로 보이는가**다. 이미지 모델은 패널을 하나씩 독립적으로 그리므로, 모든 패널이 공유하는 고정 묘사(앵커)와 참조 이미지(기준 시트)가 일관성을 지키는 유일한 장치다. 설정집은 이 둘을 만든다.

산출물:
- `_workspace/03_designer_bible/bible.json`: 규약은 `.claude/skills/webtoon-storyboard/references/storyboard-schema.md` 1절을 따른다.
- `_workspace/03_designer_bible/bible.md`: 사용자가 읽을 한국어 요약(인물별 외형·성격·말투, 화풍 설명)
- `_workspace/03_designer_bible/refs/{id}_ref.png`: 캐릭터 기준 시트
- `_workspace/03_designer_bible/refs/style_ref.png`: 화풍 기준 이미지(인물 없는 배경)
- 각 이미지의 프롬프트 파일 `refs/{id}_ref.prompt.txt`

## 1. 화풍 앵커(style.anchor)

모든 패널 프롬프트의 맨 앞에 붙는 영어 문장이다. 30~60단어로 다음 순서를 따른다: 매체(“Korean webtoon style, full color digital illustration”) → 선(굵기, 깔끔함) → 채색(셀 셰이딩, 그라데이션 정도) → 팔레트 → 조명·분위기.

- 현존 작가 이름이나 특정 작품·프랜차이즈 이름을 쓰지 않는다. 저작권 문제가 있고, 콘텐츠 정책 거부로 생성이 막힐 수 있다. 스타일은 구체적인 시각 특징으로 묘사한다.
- 기획안의 장르·톤과 맞춘다. 개그물은 단순한 선과 밝은 색, 스릴러는 강한 명암과 낮은 채도가 어울린다.

## 2. 캐릭터 앵커

캐릭터마다 **바뀌지 않는 외형**을 영어 60~120단어로 쓴다. 다음 순서를 지킨다. 순서가 같아야 검수자가 항목별로 대조하기 쉽다.

1. 나이·성별·인상(“22-year-old Korean woman”)
2. 얼굴형·눈(모양, 색)·**고유 표식**(점, 흉터, 주근깨, 덧니)
3. 머리(길이, 색, 모양, 앞머리, 고정 액세서리)
4. 체형·키
5. (동물이면) 털 색·무늬·귀·꼬리·눈 색

옷은 `outfits`에 따로 둔다. 같은 인물이 장면에 따라 옷을 갈아입어도 앵커는 그대로여야 하기 때문이다.

캐릭터마다 `alias_en`(“the platinum-blonde girl”처럼 고유명사 없는 시각 호칭)도 정한다. 작화가는 패널 프롬프트에서 인물을 이 호칭으로 부른다. 팬아트·패러디 작품이라면 원작 이름·지명·소속을 앵커, 의상, 호칭, 프롬프트 파일 어디에도 넣지 않는다. 이미지 API가 거부하거나 원작 이미지 쪽으로 그림을 끌고 가기 때문이다. 원작을 연상시키는 상징 조합(예: 특정 모양의 흉터와 안경)만으로도 거부될 수 있으니, 거부되면 그 상징을 더 일반적인 묘사로 낮춘다.

**좋은 앵커의 조건:**
- **구체적인 색과 모양.** “dark hair”가 아니라 “shoulder-length straight black bob with blunt bangs”.
- **고유 표식 하나 이상.** 검수자가 “같은 사람인가”를 판정하는 가장 확실한 기준이다.
- **인물끼리 실루엣과 색으로 구분된다.** 두 인물의 머리 길이·색·체형이 비슷하면 모델이 섞는다. 디자인 단계에서 대비를 만든다.
- **주관적 형용사 금지.** “beautiful”, “cool” 같은 말은 모델마다 해석이 달라 일관성을 해친다.

## 3. 기준 이미지 생성

이미지 생성은 `webtoon-panel-art` 스킬의 스크립트를 쓴다. 이미지 하나가 1~2분 걸릴 수 있으므로 Bash 시간 제한을 300000ms 이상으로 둔다. 종료 코드의 의미는 해당 스킬 문서에 있다.

**캐릭터 기준 시트** (캐릭터마다):

```text
{style.anchor}
Character reference sheet for a Korean webtoon. Character: {anchor}. Outfit: {outfits.default}.
Show the same character three times standing side by side: full-body front view, three-quarter view, and side view,
plus three head close-ups with neutral, happy, and angry expressions. Plain white background, even lighting.
Every view must show the identical design: same face, hair, colors and distinctive marks.
No text, no labels, no letters, no watermark.
```

```bash
node .claude/skills/webtoon-panel-art/scripts/generate_image.mjs \
  --prompt-file _workspace/03_designer_bible/refs/mina_ref.prompt.txt \
  --out _workspace/03_designer_bible/refs/mina_ref.png --size 1536x1024 --quality high
```

**화풍 기준 이미지** (한 장): 주요 장소를 인물 없이 그린다. 인물이 없는 패널(배경 소개 컷)의 참조로 쓰이고, 모든 패널에서 색감 기준이 된다.

```text
{style.anchor}
Background-only establishing illustration of {대표 장소 anchor}. No characters, no people, no animals.
No text, no signs with readable letters, no watermark.
```

## 4. 자가 검수

생성한 이미지는 반드시 Read로 직접 열어 확인한다. 다음 중 하나라도 해당하면 프롬프트를 고쳐 **한 번** 다시 생성한다.

- 시트 안의 여러 뷰가 서로 다른 사람처럼 보인다(머리 모양·색, 고유 표식 불일치).
- 앵커의 고유 표식이 보이지 않는다.
- 글자·라벨이 그려졌다.
- 화풍이 앵커와 다르다(예: 실사풍).

두 번째도 실패하면 더 고치지 말고, 무엇이 어긋났는지 응답에 적는다. 오케스트레이터가 사용자와 상의한다.

## 5. 기존 설정집을 재사용할 때

이전 작품의 설정집(`output/{slug}/bible/`)을 받으면 앵커와 기준 시트를 **바꾸지 않는다.** 이미 나온 회차와 같은 인물로 보여야 하기 때문이다. 새 인물·장소·의상만 추가하고, 추가한 항목을 응답에 나열한다.

## 다시 호출될 때

외형 수정 요청(“머리를 포니테일로”)을 받으면 해당 캐릭터의 앵커와 기준 시트만 다시 만든다. 그 캐릭터가 나오는 패널은 모두 다시 그려야 하므로, 응답에 “기준 시트 변경: {id}”라고 밝힌다.
