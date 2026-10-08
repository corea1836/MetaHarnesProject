---
name: webtoon-orchestrator
description: "단편 웹툰을 기획부터 완성 이미지까지 만드는 제작 팀(작가·편집자·캐릭터 디자이너·연출가·작화가·검수자)을 조율한다. '웹툰 만들어줘', '이 아이디어로 만화 그려줘', '짧은 웹툰/인스타툰/컷툰', '캐릭터 넣어서 에피소드 하나' 같은 요청에 사용한다. 이전 웹툰의 수정과 부분 재실행(특정 컷 다시 그리기, 대사·오타 수정, 말풍선 위치, 결말 바꾸기, 캐릭터 외형 변경), dry-run 결과를 실제 그림으로 다시 실행, 이전 결과 개선, 같은 캐릭터로 다음 화 만들기에도 반드시 사용한다. 웹툰 작법에 대한 단순 질문이나 남의 웹툰 감상평에는 사용하지 않는다."
---

# 웹툰 제작 오케스트레이터

메인 에이전트가 이 문서를 따라 팀을 조율한다. 각 에이전트에게 보낼 지시문 템플릿은 `references/agent-prompts.md`에 있다. 에이전트를 처음 실행하기 전에 읽는다.

## 실행 모드: 혼합

| 단계 | 실행 모드 | 선택 이유 |
|------|----------|-----------|
| 0~1 기존 작업 확인·요청 정리 | 메인 직접 | 무엇을 할지 정하는 단계 |
| 2 기획 | 지속형 에이전트(writer, editor) | 같은 초안을 피드백으로 여러 번 고친다. 작가가 이전 맥락을 기억해야 지적된 부분만 고친다 |
| 3 설정집 ‖ 글콘티 | 서브에이전트(designer) + 지속형(writer, editor), **병렬** | 설정집은 기획안만 있으면 독립적으로 만들 수 있다 |
| 4 콘티 | 지속형(director, editor) | 콘티 수정이 반복되고, 최종 검수 뒤에도 같은 연출가에게 돌려보낸다 |
| 5 작화 | 지속형 작화가(artist-1~3) 병렬 + 단발 검수자(inspector) | 패널을 묶음으로 나눠 병렬 생성하고, 다시 그릴 패널만 같은 작화가에게 돌려보낸다. 검수는 매번 새 눈으로 본다 |
| 6 식자·합성 | 스크립트(메인 직접) | 결과가 항상 같아야 하는 기계적 작업 |
| 7 최종 검수 | 지속형(editor) | 앞 단계 검토 맥락을 기억한 채 완성본을 본다 |
| 8 납품 | 메인 직접 | |

이 환경에는 Workflow·TaskCreate 도구가 없다는 전제로 설계했다. 진행 상태는 `_workspace/run_meta.json`으로 관리한다.

## 에이전트 구성

| 역할 | `subagent_type` | 모델 | 스킬 | 산출물 |
|------|-----------------|------|------|--------|
| writer | `webtoon-writer` | opus | webtoon-storytelling | `01_writer_concept.md`, `02_writer_script.md` |
| editor | `webtoon-editor` | opus | webtoon-review | 검토 결과를 응답으로 반환 → 메인이 `0N_editor_*.md`로 저장 |
| designer | `character-designer` | opus | webtoon-character-design | `03_designer_bible/` |
| director | `storyboard-director` | opus | webtoon-storyboard | `04_director_storyboard.json` |
| artist-1~3 | `panel-artist` | sonnet | webtoon-panel-art | `05_artist_panels/` |
| inspector | `panel-inspector` | sonnet | webtoon-panel-art(체크리스트) | 판정 JSON을 응답으로 반환 → 메인이 `05_inspector_*.json`으로 저장 |

모델은 각 에이전트 정의 파일에 정해 두었다. 호출할 때 덮어쓰지 않는다.

**이어서 지시하는 방법:** Agent 호출에 `name`을 줄 수 있으면 위 역할 이름을 붙인다. 줄 수 없으면 결과로 받은 agentId를 `run_meta.json`의 `agents`에 역할 이름과 함께 기록한다. 이후 `SendMessage`의 `to`에 그 이름이나 agentId를 쓰면 작업을 마친 에이전트도 이전 맥락을 유지한 채 이어서 일한다. 세션이 바뀌면 맥락이 끊기므로, 새 세션의 후속 요청은 같은 `subagent_type`을 새로 실행하고 이전 산출물 경로를 지시문에 넣는다.

에이전트는 백그라운드에서 실행된다. 완료 알림을 받기 전에 결과를 단정하지 않고, 이미 맡긴 일을 메인이 다시 하지 않는다.

## 작업 폴더

```
_workspace/
├── run_meta.json                      진행 상태(아래 예시)
├── 00_input/request.md                정리한 요청
├── 01_writer_concept.md               기획안
├── 01_editor_concept_review_r{n}.md
├── 02_writer_script.md                글콘티
├── 02_editor_script_review_r{n}.md
├── 03_designer_bible/                 bible.json, bible.md, refs/
├── 04_director_storyboard.json        연출 콘티
├── 04_validate.json                   메인이 직접 돌린 검사 결과
├── 04_editor_storyboard_review_r{n}.md
├── freeze_04.sha                      작화 전 동결 해시
├── 05_artist_panels/                  {id}_v{n}.png, .prompt.txt, .meta.json
├── 05_inspector_b{k}_r{n}.json        묶음 k, 회차 n 검수 결과
├── 05_selected.json                   패널별 채택 버전 { "p01": "p01_v2.png" }
├── 06_compose/                        episode.html, strips/, layout.json
└── 07_editor_final_review_r{n}.md
```

최종 산출물은 `output/{slug}/`에 둔다(8단계). `_workspace/`는 지우지 않는다.

```json
{
  "slug": "convenience-cat", "title": "편의점 고양이", "started": "2026-10-08T10:00",
  "mode": "live", "image_model": "gpt-image-2.5-flare", "quality": "high",
  "target_panels": "8-12", "checkpoints": true,
  "agents": { "writer": "writer", "editor": "a1b2-...", "director": "director", "artist-1": "artist-1" },
  "phases": { "concept": "done", "script": "done", "bible": "done", "storyboard": "done",
              "art": "in_progress", "compose": "pending", "final_review": "pending", "delivered": "pending" },
  "images_generated": 14,
  "unresolved": [ { "panel": "p07", "reason": "2회 재생성 후에도 손 결함", "kept": "p07_v3.png" } ]
}
```

## 0단계: 기존 작업 확인

1. `_workspace/run_meta.json`이 있는지 확인한다.
   - **없으면** 새 작업으로 1단계부터 진행한다.
   - **있고 같은 작품을 고치는 요청이면** 아래 표에서 다시 할 단계만 실행한다.
   - **있고 새 작품 요청이면** `_workspace/`를 `_workspace_{YYYYMMDD_HHMM}/`로 옮긴 뒤 새로 시작한다.
2. “다음 화”, “같은 캐릭터로” 요청이면 `output/{slug}/bible/`을 `_workspace/03_designer_bible/`로 복사해 두고 새 작업으로 진행한다. 3단계의 designer는 새 항목만 추가한다.

| 요청 예 | 다시 할 단계 | 새로 생성할 이미지 |
|---------|-------------|-------------------|
| 대사 수정, 오타, 말풍선 위치, 여백 | 콘티의 식자 필드만 수정 → 6 → 8 | 없음 |
| “3번 컷 다시 그려줘”, “표정만 바꿔” | 5(해당 패널만, 사용자 피드백을 `fix_prompt`로) → 6 → 8 | 해당 컷 |
| 구도·컷 순서·컷 추가 | 4(director) → 작화 필드가 바뀐 패널만 5 → 6 → 7 → 8 | 바뀐 컷 |
| 캐릭터 외형 변경 | 3(designer, 해당 캐릭터) → 그 캐릭터가 나오는 패널 모두 5 → 6 → 7 → 8 | 해당 컷 전부 |
| 결말·분위기 변경 | 2~3(writer) → 4 → 바뀐 패널 5 → 6 → 7 → 8 | 바뀐 컷 |
| dry-run 결과를 실제 그림으로 | 3(designer: 기준 시트만 실제 생성) → 5 전체 → 6 → 7 → 8 | 전부 |

dry-run 기준 시트는 자리표시 이미지라서 실제 작화의 참조로 쓸 수 없다. 그래서 마지막 행은 기준 시트부터 다시 만든다. 이미지를 다시 생성하는 요청이면 시작하기 전에 생성할 이미지 수를 사용자에게 알린다.

## 1단계: 요청 정리

1. 사용자 요청에서 아이디어, 장르·톤, 분량, 인물, 화풍 선호, 피할 요소, 업로드 규격을 뽑는다. 없는 값은 기본값을 쓴다. 기본값은 그림 컷 8~12개, 800×1280 조각, 품질 `high`, 기본 이미지 모델이다.
2. 아이디어가 전혀 없을 때(“웹툰 하나 만들어줘”)만 장르와 소재를 한 번 묻는다. 그 밖의 빈칸은 작가가 채운다.
3. 이미지 API를 미리 점검한다.
   ```bash
   node .claude/skills/webtoon-panel-art/scripts/generate_image.mjs --check
   ```
   종료 코드가 2면 프로젝트 루트 `.env`에 `OPENAI_API_KEY=...`를 넣는 방법을 안내하고, 이야기와 콘티를 자리표시 그림으로 먼저 볼 수 있는 **dry-run**으로 진행할지 묻는다. dry-run이면 모든 이미지 생성 지시에 `--dry-run`을 넣는다.
4. 사용자가 “알아서 끝까지”, “확인 없이”라고 했으면 `checkpoints: false`로 두고 2·4단계의 확인을 건너뛴다.
5. `_workspace/00_input/request.md`와 `run_meta.json`을 만든다.

## 2단계: 기획

**실행 모드:** 지속형 에이전트 협업

1. writer를 실행해 `01_writer_concept.md`를 쓰게 한다.
2. 완료되면 editor를 실행해 기획안 검토(webtoon-review 1절)를 맡긴다. 응답을 `01_editor_concept_review_r1.md`로 저장한다.
3. 판정이 “수정 후 통과”나 “재작업”이면 `SendMessage`로 writer에게 리뷰 파일 경로를 주고 **필수 수정**을 반영하게 한다. 그다음 editor에게 재검토를 요청한다. 이 왕복은 최대 2회다. 그래도 필수 항목이 남으면 사용자 확인 때 함께 보여 준다.
4. **확인 1:** 사용자에게 제목, 로그라인, 인물, 비트 시트를 짧게 보여 주고 진행할지 묻는다. 수정 요청은 writer에게 그대로 전달한다.

## 3단계: 설정집 ‖ 글콘티

**실행 모드:** designer는 서브에이전트, writer·editor는 지속형. 한 메시지에서 동시에 시작한다.

- designer를 실행한다. 입력은 승인된 기획안과 재사용할 설정집(있으면), 출력은 `03_designer_bible/`이다. live 또는 dry-run 모드를 지정한다.
- `SendMessage`로 writer에게 글콘티 `02_writer_script.md` 작성을 지시한다.

각 완료 알림을 받는 대로 처리한다.

- **writer 완료:** editor에게 글콘티 검토(2절)를 보낸다. 응답을 `02_editor_script_review_r{n}.md`로 저장하고 2단계와 같은 방식으로 최대 2회 왕복한다.
- **designer 완료:** 메인이 직접 설정집을 검사하고 기준 시트 이미지를 Read로 열어 본다. 오류가 있으면 `SendMessage`로 designer에게 돌려보낸다. designer가 두 번 생성해도 실패했다고 보고하면 사용자에게 보여 주고 방향을 묻는다.
  ```bash
  node .claude/skills/webtoon-storyboard/scripts/validate_storyboard.mjs --bible-only _workspace/03_designer_bible/bible.json
  ```

## 4단계: 콘티

**실행 모드:** 지속형 에이전트 협업

1. director를 실행한다. 입력은 글콘티, 설정집, 목표 컷 수이고 출력은 `04_director_storyboard.json`이다.
2. 완료되면 메인이 직접 검사를 실행해 `04_validate.json`으로 저장한다. 에이전트의 “통과했다”는 보고만 믿지 않는다.
   ```bash
   node .claude/skills/webtoon-storyboard/scripts/validate_storyboard.mjs _workspace/04_director_storyboard.json \
     --bible _workspace/03_designer_bible/bible.json --expect 8-12 > _workspace/04_validate.json
   ```
3. editor에게 콘티 검토(3절)를 보낸다. 검사 결과 경로도 함께 준다. 응답을 저장하고 director와 최대 2회 왕복한다.
4. **동결:** 작화가 시작되면 콘티와 설정집이 바뀌어서는 안 된다. 그림이 서로 다른 버전을 보고 그려지기 때문이다.
   ```bash
   shasum _workspace/04_director_storyboard.json _workspace/03_designer_bible/bible.json > _workspace/freeze_04.sha
   ```
   writer, designer, director에게 `SendMessage`로 동결을 알린다. 이후 고칠 점이 생기면 파일을 직접 고치지 말고 메인에게 알리라고 지시한다.
5. **확인 2(비용 발생 전):** 사용자에게 다음을 보여 주고 작화를 시작할지 묻는다.
   - 캐릭터 기준 시트 경로와 `bible.md` 요약
   - 컷 목록 표(id, beat, size)
   - 생성할 이미지 수: 그림 컷 N장, 재생성을 포함하면 최대 약 1.6N장. 모델과 품질도 함께 알린다.

## 5단계: 작화

**실행 모드:** 지속형 작화가 병렬 + 단발 검수자

1. `shasum -c _workspace/freeze_04.sha`로 동결 상태를 확인한다. 바뀌었으면 무엇이 바뀌었는지 보고 검사부터 다시 실행한다.
2. 그림 패널(`kind: art`)을 순서대로 묶는다. 묶음 하나에 최대 4컷, 작화가는 최대 3명이다(컷이 12개를 넘으면 묶음을 키운다). 이웃한 컷을 같은 작화가가 맡아야 연속 장면의 조명과 배치가 이어진다.
3. 한 메시지에서 작화가들을 동시에 실행한다. 지시문에 묶음의 패널 id, 회차 1, 모드, 모델, 품질을 넣는다.
4. **작화가 하나가 끝날 때마다** 다른 작화가를 기다리지 않고 바로 처리한다.
   - 보고 JSON에 `HALTED`(종료 코드 2: 키·결제·권한)가 있으면 다른 작화가도 같은 이유로 실패한다. `TaskStop`으로 나머지 작업을 멈추고 사용자에게 원인과 해결 방법을 알린다. 재시도하지 않는다.
   - `DONE` 패널을 검수자 한 명에게 맡긴다. 앞뒤 패널 파일이 있으면 연속성 확인용으로 함께 넘긴다. 응답 JSON을 `05_inspector_b{k}_r{n}.json`으로 저장한다.
5. 패널별 판정을 처리한다.
   - **PASS**: `05_selected.json`에 채택 파일을 기록한다.
   - **FIX·REDO**: 해당 패널 id, 판정, `fix_prompt`를 모아 `SendMessage`로 같은 작화가에게 보낸다. 다음 회차로 다시 그리게 하고 새 결과를 다시 검수한다. 재생성은 패널당 **최대 2회**다.
   - 2회 뒤에도 PASS가 아니면 `score`가 가장 높은 버전을 채택하고 `unresolved`에 이유와 함께 기록한다.
   - **BLOCKED·FAILED**: `unresolved`에 기록한다. 최종 보고에서 해당 컷을 글자 카드로 바꾸는 방법을 제안한다.
6. **체계적 문제 점검:** 1회차에서 절반 이상의 패널이 REDO이고 이유가 같다면(예: 같은 인물이 계속 다르게 나옴), 재생성을 멈춘다. 원인은 패널이 아니라 설정집 앵커·기준 시트나 프롬프트 규칙에 있을 가능성이 크다. 사용자에게 상황을 알리고 designer에게 해당 앵커·기준 시트 수정을 맡길지 묻는다. 그대로 재생성하면 비용만 늘어난다.
7. 생성한 이미지 수를 `run_meta.json`의 `images_generated`에 누적한다.

## 6단계: 식자·합성

**실행 모드:** 스크립트(메인 직접). 방법은 webtoon-lettering 스킬을 따른다.

```bash
node .claude/skills/webtoon-lettering/scripts/compose_episode.mjs --storyboard _workspace/04_director_storyboard.json \
  --panels _workspace/05_artist_panels --select _workspace/05_selected.json --out _workspace/06_compose \
  --split panels --max-gap 80 --strips-dir strips_sns
```

같은 명령을 게시처별 옵션으로 여러 번 실행한다. 기본은 SNS·커뮤니티용(`strips_sns`)과 한 장짜리(`--split none --strips-dir strips_full`) 두 가지이고, 사용자가 웹툰 플랫폼 업로드를 말했으면 고정 분할(`--split fixed`)을 더한다. 옵션의 의미는 webtoon-lettering 스킬의 「게시처별 출력」에 있다.

채택할 이미지가 없는 패널이 있으면 `--allow-missing`을 붙이고 보고서에 적는다. 합성 뒤에는 `strips/`를 모두 Read로 열어 보고, 말풍선이 얼굴을 가리는 것처럼 명백한 배치 문제는 메인이 콘티의 **식자 필드**(`balloons`, `sfx`, `gap_before`, `gutter_color`, `card`)만 고쳐 다시 합성한다. 식자 필드는 그림에 영향을 주지 않으므로 동결 뒤에도 고칠 수 있다. 작화 필드(`size`, `shot`, `angle`, `characters`, `visual_prompt`, `negative_space`)를 바꿔야 한다면 5단계로 돌아가야 한다.

## 7단계: 최종 검수

**실행 모드:** 지속형(editor)

1. `SendMessage`로 editor에게 완성본 검수(webtoon-review 4절)를 맡긴다. `unresolved` 목록도 함께 준다. 응답을 `07_editor_final_review_r1.md`로 저장한다.
2. 필수 수정을 담당별로 나눈다.
   - `lettering`: 메인이 식자 필드를 고치고 다시 합성한다.
   - `writer`: writer에게 해당 대사를 고치게 한 뒤 메인이 콘티 말풍선에 반영하고 다시 합성한다.
   - `artist`·`director`·`designer`: 그림을 다시 그려야 한다. 두 컷 이하면 5단계로 진행하고, 그보다 많으면 사용자에게 이미지 수를 알리고 묻는다.
3. 최종 검수 뒤 수정은 1회만 한다. 남은 항목은 보고서에 적고 납품한다.

## 8단계: 납품

1. `output/{slug}/`가 이미 있으면 `output/{slug}_{YYYYMMDD_HHMM}/`로 옮긴다.
2. 다음 파일을 `output/{slug}/`에 복사한다: `06_compose/`의 `episode.html`·`panels/`·만든 조각 폴더(`strips_sns/`, `strips_full/`, 필요하면 `strips/`)·`layout*.json`, `storyboard.json`(콘티), `script.md`(글콘티), `concept.md`(기획안), `bible/`(설정집 폴더 전체). 최종 검수에서 결함이 지적된 조각 폴더는 고치지 못했으면 빼고 그 이유를 보고한다.
3. 사용자에게 보고한다.
   - 보는 방법: `open output/{slug}/episode.html`, 게시처별 조각 폴더와 어디에 쓰는지
   - 그림 컷 수, 생성한 이미지 수(재생성 포함), 미해결 항목과 이유
   - 다음에 할 수 있는 요청 예: “5번 컷 표정만 다시”, “대사 더 짧게”, “같은 캐릭터로 2화”
4. `run_meta.json`의 `phases.delivered`를 `done`으로 바꾼다.

## 오류 처리

| 상황 | 대응 |
|------|------|
| 이미지 API 종료 코드 2(키 없음·인증·결제·권한) | 재시도하지 않는다. 진행 중인 작화를 멈추고 원인과 `.env` 설정 방법을 알린다. 이미 만든 산출물은 그대로 두고, 해결되면 5단계부터 이어서 실행할 수 있다고 안내한다 |
| 사용량 한도 소진 | 재시도하지 않는다. 부분 산출물을 직접 열어 어디까지 진행됐는지 확인하고, 누락 내용을 `_workspace/`에 파일로 남긴다. 사용자에게 보고하고, 한도가 풀리는 시각을 알면 함께 알린다 |
| 콘텐츠 정책 거부(종료 코드 3) | 작화가가 표현을 완화해 한 번만 다시 시도한다. 그래도 막히면 BLOCKED로 두고 글자 카드 대체를 제안한다 |
| 에이전트가 응답하지 않거나 실패 | `SendMessage`로 상태를 확인하고 한 번 다시 지시한다. 그래도 실패하면 같은 `subagent_type`을 새로 실행하고 산출물 경로를 넘긴다. 새로 실행한 에이전트의 이름이나 agentId를 `run_meta.json`에 갱신한다 |
| 에이전트가 멈춰 산출물이 비었음 | 메인이 직접 확인한 사실(파일 존재, 검사 결과)만 대신 기록한다. 에이전트의 판단(왜 그렇게 그렸는지, 어떤 버전이 나은지)은 추측해 채우지 않는다 |
| 검수자 응답이 JSON이 아님 | 한 번 다시 요청한다. 또 실패하면 메인이 이미지를 직접 열어 판정하고 `05_inspector_*.json`에 `"by": "main"`을 남긴다 |
| 콘티 검사 오류가 2회 왕복 뒤에도 남음 | 남은 오류를 사용자에게 보여 주고, 해당 패널을 빼거나 단순화할지 묻는다 |
| 합성 종료 코드 2(Chrome 없음) | `--html-only`로 HTML만 만들고, Chrome 설치나 `CHROME_PATH` 설정을 안내한다 |
| 절반 넘는 에이전트가 실패 | 사용자에게 알리고 계속할지 묻는다 |

## 테스트 시나리오

### 정상 흐름

1. 사용자: “새벽 편의점 알바생이랑 매일 오는 고양이 이야기로 10컷 웹툰 만들어줘. 따뜻하고 살짝 웃기게.”
2. 1단계에서 API 점검이 통과하고 `run_meta.json`이 `mode: live`로 만들어진다.
3. 2단계에서 기획안 → 편집자 검토 1회 → 사용자 확인.
4. 3단계에서 설정집(인물 2, 기준 시트 3장)과 글콘티가 병렬로 끝난다.
5. 4단계에서 콘티가 검사 오류 0건으로 통과하고 동결된다. 사용자 확인에서 “그림 컷 10장, 최대 약 16장”을 안내한다.
6. 5단계에서 작화가 3명이 4·3·3컷을 맡는다. 검수 1회차에서 2컷이 FIX, 2회차에서 모두 PASS다.
7. 6~8단계를 거쳐 `output/convenience-cat/episode.html`과 `strips/`(조각 7~10개)가 생성되고, 보고서에 생성 이미지 15장이 기록된다.

### 오류 흐름 1: API 키 없음

1. 1단계 점검이 종료 코드 2로 끝난다.
2. `.env` 설정 방법을 안내하고 dry-run으로 진행할지 묻는다. 사용자가 동의한다.
3. 모든 단계가 자리표시 그림으로 끝나고, 보고서에 “dry-run: 실제 그림 없음”이 표시된다.
4. 나중에 사용자가 키를 넣고 “실제 그림으로 다시”라고 하면 0단계 표의 마지막 행대로 기준 시트부터 다시 만든다.

### 오류 흐름 2: 체계적 인물 불일치

1. 5단계 1회차 검수에서 10컷 중 6컷이 REDO이고, 이유가 모두 “미나의 머리 길이가 기준 시트와 다름”이다.
2. 재생성을 멈추고 사용자에게 알린다. designer에게 앵커의 머리 묘사를 더 구체적으로 고치고 기준 시트를 다시 만들게 한다.
3. 동결 해시를 다시 만들고 해당 6컷만 다시 그린다. 보고서에 원인과 조치를 적는다.
