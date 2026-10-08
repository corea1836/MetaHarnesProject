# 콘티(storyboard.json)·설정집(bible.json) 데이터 규약

작화(`panel-artist`)와 식자·합성(`compose_episode.mjs`)은 이 규약을 그대로 읽어 동작한다. 필드 이름이나 값의 범위를 바꾸면 뒤 단계가 깨지므로, 바꿔야 하면 `validate_storyboard.mjs`와 `compose_episode.mjs`도 함께 고친다.

## 목차

1. 설정집 bible.json
2. 콘티 storyboard.json — 최상위
3. 그림 패널(kind: art)
4. 글자 카드(kind: card)
5. 말풍선 balloons
6. 효과음 sfx
7. 전체 예시

---

## 1. 설정집 bible.json

위치: `_workspace/03_designer_bible/bible.json`. `ref` 경로는 bible.json 기준 상대 경로다(`refs/mina_ref.png`). 폴더째 복사해도 경로가 유지된다.

```json
{
  "title": "편의점 고양이",
  "style": {
    "anchor": "Korean webtoon style, clean confident line art, soft cel shading, warm pastel palette, expressive faces, full color digital illustration",
    "palette": "warm pastel, night scenes in teal and amber",
    "notes_ko": "따뜻한 일상물 톤. 밤 장면도 무섭지 않게.",
    "ref": "refs/style_ref.png"
  },
  "characters": [
    {
      "id": "mina",
      "name": "미나",
      "role": "주인공, 편의점 야간 알바생",
      "anchor": "22-year-old Korean woman, oval face, round brown eyes, small mole under left eye, shoulder-length straight black bob with blunt bangs, slim build, average height",
      "outfits": {
        "default": "green convenience-store vest over plain white t-shirt, dark jeans, white sneakers",
        "home": "oversized grey hoodie, black shorts"
      },
      "personality_ko": "무뚝뚝하지만 속정 깊음",
      "speech_ko": "짧은 반말 혼잣말, 손님에게는 기계적인 존댓말",
      "ref": "refs/mina_ref.png"
    }
  ],
  "locations": [
    { "id": "store", "name": "편의점", "anchor": "small Korean convenience store interior at night, fluorescent ceiling lights, snack shelves, glass front door, counter with register" }
  ]
}
```

| 필드 | 규칙 |
|------|------|
| `style.anchor` | 영어 40자 이상. 모든 패널 프롬프트 맨 앞에 그대로 붙는다. |
| `characters[].id` | 영문 소문자 snake_case. 콘티·파일 이름에서 키로 쓴다. 이미지 프롬프트에는 들어가지 않는다. |
| `characters[].alias_en` | 이미지 프롬프트에서 인물을 가리키는 중립적인 영어 시각 호칭(“the boy with glasses”). 고유명사를 넣지 않는다. 팬아트·패러디처럼 id나 이름이 원작에서 온 경우 필수이고, 그 밖에도 권장한다. |
| `characters[].anchor` | 영어 60자 이상의 **불변 외형**(얼굴·머리·체형·고유 표식). 옷은 `outfits`로 분리한다. 한글을 넣지 않는다. 이미지에 글자로 그려질 수 있다. |
| `characters[].outfits` | 이름 → 영어 묘사. 콘티 패널의 `characters[].outfit`이 이 이름을 가리킨다. 없으면 `default`. |
| `characters[].ref` | 기준 시트 이미지. 작화 단계에서 참조 이미지로 넘긴다. |
| `locations[]` | 반복해서 나오는 장소. 콘티의 `location`이 id를 가리킨다. |

## 2. 콘티 storyboard.json — 최상위

```json
{ "title": "편의점 고양이", "slug": "convenience-cat", "episode": 1,
  "logline": "새벽 편의점 알바생과 매일 찾아오는 고양이", "panels": [ ... ] }
```

- `slug`: 영문 소문자·숫자·하이픈. 최종 산출물 폴더 이름(`output/{slug}/`)이 된다.
- `panels`: 위에서 아래로 읽히는 순서 그대로 나열한다.

## 3. 그림 패널(kind: art)

| 필드 | 필수 | 값 | 설명 |
|------|------|----|------|
| `id` | ✔ | `p01`, `p02` … | 순서와 무관한 고유 키. 중간에 컷을 넣을 때 기존 id를 바꾸지 말고 `p03b` 대신 다음 빈 번호를 쓴다. |
| `kind` | | `art`(기본) | |
| `beat` | 권장 | 한국어 한 줄 | 이 컷이 이야기에서 하는 일. 검수자가 의도를 판단하는 근거다. |
| `shot` | ✔ | `establishing` `wide` `full` `medium` `close-up` `extreme-close-up` `insert` | |
| `angle` | ✔ | `eye-level` `high` `low` `bird` `worm` `dutch` `over-shoulder` `pov` | |
| `size` | ✔ | `WIDTHxHEIGHT` | 이미지 API 제약: 16의 배수, 비율 1:3~3:1, 총 픽셀 655,360~8,294,400. 아래 표 참고. |
| `characters` | ✔ | `[{id, expression, pose, outfit?}]` | 인물이 없으면 `[]`. 외형은 쓰지 않는다(설정집에서 온다). |
| `location` | | 설정집 장소 id 또는 자유 영어 묘사 | |
| `setting` | | 영어 | 시간대·조명·날씨 등 이 컷만의 환경. |
| `visual_prompt` | ✔ | 영어 20자 이상 | 구도·동작·감정. 글자가 들어가는 소품(간판 문구, 편지 내용)은 묘사하지 않는다. |
| `negative_space` | 그림 위 말풍선이 있으면 ✔ | `top-left` `top` `top-right` `left` `center` `right` `bottom-left` `bottom` `bottom-right` `none` | 작화가 비워 둘 자리. `over` 말풍선 좌표와 일치시킨다. |
| `gap_before` | | 0~2000(px, 가로 800 기준) | 이 컷 앞 여백. 기본 60. |
| `gutter_color` | | `#rrggbb` | 여백과 칸 밖 말풍선 줄의 배경색. 회상·밤은 검정 계열. |
| `frame` | | `bleed`(기본) `framed` | `bleed`는 가로 전체, `framed`는 테두리 있는 칸. |
| `balloons` | | 배열 | 5절 |
| `sfx` | | 배열 | 6절 |

**권장 size:**

| size | 비율 | 쓰임 |
|------|------|------|
| `1024x1536` | 2:3 세로 | 배경 소개, 전신, 감정이 큰 컷 |
| `1024x2048` | 1:2 세로 | 낙하·높이·큰 리빌. 화당 1~2번만 |
| `1536x1024` | 3:2 가로 | 두세 명 대화, 넓은 동작 |
| `1024x1024` | 1:1 | 얼굴 클로즈업, 반응 컷 |
| `1024x640` | 1.6:1 띠 | 짧은 리액션, 손·소품 인서트 |

## 4. 글자 카드(kind: card)

그림 없이 색 배경과 글자만 있는 칸이다. 이미지를 생성하지 않으므로 비용이 없다.

```json
{ "id": "p06", "kind": "card", "card": { "text": "다음 날 새벽", "bg": "#000000", "color": "#ffffff", "height": 400 }, "gap_before": 120 }
```

쓰임: 제목 카드, 시간 경과(“다음 날”), 장면 전환, 마지막의 “끝”. `height`는 100~2000(px), 기본 480.

## 5. 말풍선 balloons

```json
{ "type": "speech", "speaker": "mina", "text": "어서오세요~", "placement": "over", "x": 6, "y": 8, "w": 34, "tail": "bottom-right" }
```

| 필드 | 값 | 설명 |
|------|----|------|
| `type` | `speech` 대사 · `thought` 속마음 · `shout` 외침 · `whisper` 속삭임 · `electronic` 전화·방송·메시지 · `narration` 내레이션 | |
| `speaker` | 설정집 캐릭터 id 또는 `extra:이름` | `narration`을 빼고 모두 필수 |
| `text` | 한국어 | 줄바꿈은 `\n`. 한 풍선 40자 이하 권장. |
| `placement` | `over` 그림 위 · `gutter-before` 컷 위 여백 · `gutter-after` 컷 아래 여백 | 긴 대사와 내레이션은 여백에 둬야 그림을 가리지 않는다. |
| `x`, `y`, `w` | 0~100(%) | `over`일 때 필수. 패널 좌상단 기준 풍선 왼쪽 위 모서리와 너비. `x + w ≤ 100`. |
| `align` | `left` `center` `right` | 여백 말풍선의 정렬. 생략하면 가운데. |
| `tail` | `none` `top` `top-left` `top-right` `bottom` `bottom-left` `bottom-right` `left` `right` | 화자 쪽을 가리킨다. 화면 밖 목소리는 `none`. |

여백(`gutter-*`)에 둔 `narration`은 테두리 없는 글줄로 그려진다. 장면 사이의 독백·해설에 쓴다.

## 6. 효과음 sfx

```json
{ "text": "쾅", "x": 70, "y": 60, "size": "l", "rotate": -10, "color": "#e33333" }
```

`x`, `y`는 글자 **중심**의 위치(%)다. `size`는 `s` `m` `l` `xl`, `rotate`는 -45~45도다.

## 7. 전체 예시

```json
{
  "title": "편의점 고양이", "slug": "convenience-cat", "episode": 1,
  "logline": "새벽 편의점 알바생과 매일 찾아오는 고양이",
  "panels": [
    { "id": "p01", "kind": "card", "card": { "text": "편의점 고양이", "bg": "#1d1d2b", "color": "#ffe9a8", "height": 600 }, "gap_before": 0 },
    { "id": "p02", "beat": "새벽 3시, 텅 빈 거리에 편의점만 빛난다", "shot": "establishing", "angle": "high", "size": "1024x1536",
      "characters": [], "location": "store", "setting": "3am, wet asphalt, cold blue night with warm shop light",
      "visual_prompt": "Exterior of a small convenience store glowing alone on a dark empty street, light spilling onto wet asphalt",
      "negative_space": "top", "gap_before": 0,
      "balloons": [ { "type": "narration", "text": "새벽 세 시.\n이 시간엔 손님이 거의 없다.", "placement": "over", "x": 20, "y": 5, "w": 60 } ] },
    { "id": "p03", "beat": "졸던 미나, 문 열리는 소리에 기계적으로 인사", "shot": "medium", "angle": "eye-level", "size": "1536x1024",
      "characters": [ { "id": "mina", "expression": "sleepy, half-closed eyes", "pose": "leaning on the counter, chin on hand" } ],
      "location": "store", "visual_prompt": "Mina leaning on the counter half asleep, glass door in the background starting to open",
      "negative_space": "top-left", "gap_before": 80,
      "balloons": [ { "type": "speech", "speaker": "mina", "text": "어서오세요~", "placement": "over", "x": 6, "y": 8, "w": 34, "tail": "bottom-right" } ],
      "sfx": [ { "text": "딸랑", "x": 82, "y": 22, "size": "m", "rotate": -10, "color": "#e2a400" } ] }
  ]
}
```
