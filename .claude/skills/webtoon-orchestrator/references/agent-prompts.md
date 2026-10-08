# 에이전트 지시문 템플릿

오케스트레이터가 에이전트를 실행하거나 `SendMessage`로 이어서 지시할 때 쓰는 지시문이다. `{중괄호}`를 채워 넣는다. 에이전트의 역할과 원칙은 `.claude/agents/`의 정의 파일에 이미 있으므로, 지시문에는 **이번 작업의 입력·출력·조건**만 담는다.

## 목차

1. 공통 규칙
2. writer
3. editor
4. designer
5. director
6. artist
7. inspector

---

## 1. 공통 규칙

- 경로는 프로젝트 루트 기준 상대 경로로 쓴다.
- 지속형 에이전트(writer, editor, director, artist)를 **처음 실행할 때**는 지시문 끝에 다음 문장을 붙인다. 정의 파일의 `tools`에 적은 도구가 실제로 주어지지 않는 경우가 있어, 빠진 도구를 일찍 발견하기 위해서다.
  > 응답 첫 줄에 지금 실제로 사용할 수 있는 도구 이름을 쉼표로 나열하라.
- 보고된 도구 목록에 필요한 도구(작성자는 Write·Edit, 작화가는 Bash)가 없으면 그 에이전트의 일을 메인이 대신하거나, 정의 파일의 `tools` 제한을 풀고 새로 실행한다.
- 사용자 피드백을 전달할 때는 사용자의 표현을 그대로 인용하고, 메인의 해석은 따로 표시한다.

## 2. writer

**처음 실행(기획안):**

```text
단편 웹툰 기획안을 써라.
- 먼저 .claude/skills/webtoon-storytelling/SKILL.md를 읽고 따른다.
- 요청: _workspace/00_input/request.md
- 분량: 그림 컷 {8~12}개
- 출력: _workspace/01_writer_concept.md
완료하면 로그라인 한 줄과 인물 목록을 응답한다.
```

**피드백 반영:**

```text
기획안을 수정하라. 편집자 검토: _workspace/01_editor_concept_review_r{n}.md
"필수 수정"은 모두 반영하고, "권장 수정"은 동의하는 것만 반영하라. 반영하지 않은 권장 항목은 이유를 한 줄씩 적어라.
같은 파일을 고치고, 바꾼 부분을 응답에 나열하라.
```

**글콘티:**

```text
승인된 기획안(_workspace/01_writer_concept.md)으로 글콘티를 써라.
- 출력: _workspace/02_writer_script.md (webtoon-storytelling 2절 형식)
- 사용자 의견: {있으면 원문 인용, 없으면 "없음"}
완료하면 컷 수(그림/글자 카드)를 응답한다.
```

## 3. editor

**처음 실행(기획안 검토):**

```text
웹툰 담당 편집자로서 기획안을 검토하라.
- 먼저 .claude/skills/webtoon-review/SKILL.md를 읽고, 1절 기준과 피드백 형식을 따른다.
- 대상: _workspace/01_writer_concept.md
- 요청 원문: _workspace/00_input/request.md
검토 결과 마크다운 전체를 응답으로 반환하라(파일은 메인이 저장한다).
```

**이후 단계(SendMessage):**

```text
{글콘티|연출 콘티|완성본} 검토를 맡긴다. webtoon-review {2|3|4}절을 따른다.
- 대상: {_workspace/02_writer_script.md | _workspace/04_director_storyboard.json + 검사 결과 _workspace/04_validate.json | _workspace/06_compose/strips/ 전체}
- 참고: 설정집 _workspace/03_designer_bible/bible.md, 미해결 패널 {unresolved 요약}
- 회차: {n}. 2회차 이상이면 이전 필수 항목의 해결 여부부터 확인하라.
검토 결과 마크다운 전체를 응답으로 반환하라.
```

## 4. designer

```text
웹툰 설정집과 기준 이미지를 만들어라.
- 먼저 .claude/skills/webtoon-character-design/SKILL.md를 읽고 따른다.
- 입력: _workspace/01_writer_concept.md {재사용 설정집이 있으면: , 기존 설정집 _workspace/03_designer_bible/bible.json(앵커·기준 시트는 바꾸지 말고 새 항목만 추가)}
- 출력: _workspace/03_designer_bible/ (bible.json, bible.md, refs/)
- 이미지 생성: {live | dry-run → 모든 generate_image.mjs 호출에 --dry-run}, 품질 {high}
완료하면 인물별 고유 표식 한 줄과 생성한 이미지 경로를 응답한다. 두 번 생성해도 기준 시트가 일관되지 않으면 무엇이 어긋났는지 적어라.
```

## 5. director

**처음 실행:**

```text
글콘티를 세로 스크롤 연출 콘티로 만들어라.
- 먼저 .claude/skills/webtoon-storyboard/SKILL.md와 references/storyboard-schema.md를 읽고 따른다.
- 입력: _workspace/02_writer_script.md, _workspace/03_designer_bible/bible.json
- 출력: _workspace/04_director_storyboard.json (slug: {slug})
- 분량: 그림 컷 {8~12}개
- 넘기기 전에 validate_storyboard.mjs를 --expect {8-12}로 실행해 오류를 0건으로 만들어라.
완료하면 패널 수, 남은 경고와 그대로 둔 이유를 응답한다.
```

**피드백 반영(SendMessage):**

```text
콘티를 수정하라. 편집자 검토: {_workspace/04_editor_storyboard_review_r{n}.md 또는 최종 검수 파일}
지적된 패널만 고치고 다른 패널의 id와 값은 바꾸지 마라. 검사를 다시 통과시킨 뒤,
작화 필드(size, shot, angle, characters, visual_prompt, negative_space)를 바꾼 패널 id와 식자 필드만 바꾼 패널 id를 나눠서 응답하라.
```

## 6. artist

**처음 실행:**

```text
웹툰 패널을 그려라. 너는 {artist-k}다.
- 먼저 .claude/skills/webtoon-panel-art/SKILL.md를 읽고 따른다.
- 맡은 패널: {p01, p02, p03, p04} (이 패널만 그린다)
- 콘티: _workspace/04_director_storyboard.json / 설정집: _workspace/03_designer_bible/bible.json
- 출력 폴더: _workspace/05_artist_panels/ (파일 이름 {id}_v{n}.png, 회차 1이면 v1)
- 모드: {live | dry-run → --dry-run}, 모델: {기본값 사용 | 모델명}, 품질: {high}
- 콘티와 설정집 파일은 수정하지 마라. 고칠 점이 보이면 보고에 적어라.
끝나면 스킬 5절 형식의 보고 JSON을 응답 마지막에 붙여라.
```

**재생성(SendMessage):**

```text
회차 {n+1}: 다음 패널을 다시 그려라. 버전 번호를 올리고 기존 파일은 덮어쓰지 마라.
- {p03} FIX — {fix_prompt} (스킬 4절 FIX 방식: 현재 {p03_v1.png}를 첫 참조로, --model gpt-image-2.5-sunburst)
- {p04} REDO — {fix_prompt} (처음부터 다시 생성)
{사용자 피드백이 있으면 원문 인용}
끝나면 보고 JSON을 응답 마지막에 붙여라.
```

## 7. inspector

단발 실행이다. 매 회차 새로 실행해 이전 판정에 끌려가지 않게 한다.

```text
웹툰 패널을 검수하라.
- 먼저 .claude/skills/webtoon-panel-art/references/inspection-checklist.md를 읽고 따른다.
- 묶음 {k}, 회차 {n}
- 검수할 패널과 파일: {p03: _workspace/05_artist_panels/p03_v2.png, p04: ...}
- 콘티: _workspace/04_director_storyboard.json / 설정집: _workspace/03_designer_bible/bible.json (기준 시트는 refs/)
- 연속성 확인용 앞뒤 패널: {p02: ..._v1.png, p05: ..._v1.png | 없음}
- 이전 회차 판정: {_workspace/05_inspector_b{k}_r{n-1}.json | 없음}
이미지는 모두 직접 열어 대조하라. 체크리스트의 JSON 하나만 코드 블록으로 응답하라.
```
