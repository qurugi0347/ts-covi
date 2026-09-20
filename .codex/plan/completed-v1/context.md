---
name: ts-covi-context
description: ts-covi 요구사항과 GitNexus 및 로컬 Wecovi 참고 소스의 확인된 사실
created: 2026-09-20
---

# 작업 맥락

## 사용자 요청 원문

> 그러면 \~/dev/covi/ts-covi 폴더 만들어서 git repositiory 세팅해주고
> 지금 논의한 내용토대로 plan 작성해줘 plan에는 단계적으로 어떻게 개발할지와
> 최종 목표를 함께 작성하도록 해 구현 방법같은것도 작성해주면 좋겠어

앞선 논의에서 사용자는 GitNexus의 코드 분석·적재 방식을 참고하여 함수 내부 흐름을 Scratch처럼 시각화하고, 호출마다 문법에 맞게 붙인 주석과 args를 보여주는 프로젝트를 요청했다. 결과는 로컬 데이터로 저장하고 HTML에서 읽으며, 로컬 wecovi-plugin을 참고한다.

## 이번 작업 범위와 상태

- 경로: `/Users/overdune/dev/covi/ts-covi`.
- 이번 작업은 새 로컬 Git 저장소와 개발 계획 작성이다. 제품 구현, 의존성 설치, 원격 저장소 생성·연결, commit/push는 포함하지 않는다.
- 기본 branch는 `main`. 기존 대상 폴더와 상위 적용 AGENTS.md가 없는 것을 확인한 뒤 생성했다.
- 대화로 제공된 AGENTS 지침을 적용했다. reference 저장소에 적용되는 규칙은 해당 저장소 탐색 시 적용한다.
- 설계 status는 draft다. 단계별 구현과 검증은 아직 수행하지 않았다.

## 참고 자료: GitNexus

확인 기준은 2026-09-20에 읽은 `main` commit `b888260a867fcd97a447799089e2cf416a17fd9f`다. 원격 main의 이후 변경은 이 문서의 근거에 포함하지 않는다.

| 원본 | 확인한 사실 / 활용 |
|---|---|
| [filesystem-walker.ts](https://github.com/abhigyanpatwari/GitNexus/blob/b888260a867fcd97a447799089e2cf416a17fd9f/gitnexus/src/core/ingestion/filesystem-walker.ts) | 파일 경로/크기 스캔과 내용 읽기의 분리 |
| [pipeline.ts](https://github.com/abhigyanpatwari/GitNexus/blob/b888260a867fcd97a447799089e2cf416a17fd9f/gitnexus/src/core/ingestion/pipeline.ts) | 수집·파싱·해석·파생 그래프 단계. CFG/PDG는 opt-in |
| [scope-resolution phase](https://github.com/abhigyanpatwari/GitNexus/blob/b888260a867fcd97a447799089e2cf416a17fd9f/gitnexus/src/core/ingestion/scope-resolution/pipeline/phase.ts) | 스코프 기반 import/call/inheritance 해석 |
| [cfg/types.ts](https://github.com/abhigyanpatwari/GitNexus/blob/b888260a867fcd97a447799089e2cf416a17fd9f/gitnexus/src/core/ingestion/cfg/types.ts) | 직렬화 가능한 함수 CFG, 분기·반복·종료 간선 |
| [lbug-adapter.ts](https://github.com/abhigyanpatwari/GitNexus/blob/b888260a867fcd97a447799089e2cf416a17fd9f/gitnexus/src/core/lbug/lbug-adapter.ts) | CSV 및 COPY 기반 LadybugDB 적재. ts-covi는 이 DB 계층을 복제하지 않음 |
| [LICENSE](https://github.com/abhigyanpatwari/GitNexus/blob/b888260a867fcd97a447799089e2cf416a17fd9f/LICENSE) | PolyForm Noncommercial. 소스 복제와 아이디어 참고를 구분 |

GitNexus 분석을 직접 실행한 결과가 아니라 원본 소스 확인에 근거한다. 당시 MCP list_repos에는 GitNexus와 Wecovi 인덱스가 없었다.

## 참고 자료: 로컬 Wecovi

위치: `/Users/overdune/dev/wecovi-plugin`. 확인 당시 branch는 `codex/fix-flow-canvas-ui`, resolver/editor/test/CSS 수정 및 `sample/` untracked 상태였다. 아래 내용은 commit 고정본이 아닌 수정 중인 작업 트리 관찰이며 복사나 변경하지 않았다.

| 상대 파일 | 확인된 사실 |
|---|---|
| `src/main/kotlin/com/wecovi/plugin/service/FlowService.kt` | VFS 탐색 → PSI 파일 → 분석/호출 해석 |
| `src/main/kotlin/com/wecovi/plugin/model/FlowContracts.kt` | 직렬화 모델에 kind/label/codeExpression/sourceLocation/targetSymbolId/children |
| `src/main/kotlin/com/wecovi/plugin/analysis/TypeScriptFlowAnalyzer.kt` | 표현식·return·변수 초기화 처리. 조건/반복/try 분석은 현재 구현에서 누락. 콜백 본문 제외 |
| `src/main/kotlin/com/wecovi/plugin/analysis/CoviMetadataIndexer.kt` | 함수의 @covi/@covi-root/@covi-group 해석 |
| `src/main/kotlin/com/wecovi/plugin/analysis/CallTargetResolver.kt` | 호출된 함수 설명을 label에 반영. 호출 위치별 주석과 다름 |
| `ui/src/main.tsx` | document/result 메시지 수신과 중첩 카드 표시. standalone 뷰어에서는 IDE bridge 대체 필요 |
| `sample/order-api/order-service.ts` | 주문 처리 직선 흐름, 검증 if/throw, reduce 콜백을 검증 사례로 참고 가능 |

Wecovi의 plugin-only 문서 방향과 별개로 이번 사용자 요청은 독립 CLI/JSON/HTML 제품이다. UI/모델 개념을 참고하되 기존 저장소의 작업을 옮기거나 수정하지 않는다.

## 제안과 확정 사실 구분

- 사용자 요구: 새 저장소, 단계별 plan, 최종 목표 및 구현 방법, 로컬 데이터와 HTML, Scratch 형태 및 주석 표시.
- 구현 제안: TypeScript Compiler API, JSON 우선, 단일 패키지, React 중첩 블록, 호출 위치별 @covi-call JSON 문법. 자세한 선택 이유는 [계획](plan.md)에 있다.
- 아직 미검증: 성능, 전체 구문 지원 정확성, standalone 빌드 방식과 런타임 버전 조합. M1~M6에서 검증한다.
- [TypeScript 공식 Compiler API 문서](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)를 참고했다. 확인 당시 문서는 6.0 이하 API 대상이며 7.1 API 변경을 안내하므로 구현 시 호환 버전을 고정한다.

실행 상태는 [체크리스트](checklist.md)를 기준으로 한다.


## 2026-09-20 실행 계획 보강

요청 원문: “저 내용 기반으로 작업 계획 작성해줘 [$TaskPlan] … [@Ponytail]”. 앞선 인계 내용의 M1→M6 순서와 정확성 원칙을 실행 Task로 구체화한다.

- 목적: 정적 구조를 원본 프로젝트 없이 읽을 수 있는 JSON/HTML 도구를 단계적으로 완성한다.
- 문제: 기존 문서는 제품 설계와 milestone 중심이며, 작업별 파일·선행 조건·검증 연결 및 architecture overview가 부족했다.
- 방법: 기존 설계를 보존하고 M1.1~M6.2 Task, 재사용 판단, overview, 인수 체크를 추가한다. 구현이나 패키지 설치는 하지 않는다.
- 직접 재확인: HANDOFF.md, README.md, 계획 3종, .gitignore, git status. main은 커밋이 없고 문서 6개가 untracked였다. package.json·코드·기존 테스트·빌드 명령은 없다. 변경 가능한 제품 패턴도 아직 없다.
- 적용 지침: 대화로 제공한 AGENTS.md. 대상 저장소 및 상위 경로에 추가 AGENTS.md는 발견되지 않았다.
- 구성 영향: M1에서 단일 패키지와 빌드를 신설한다. DB·API 서버·배포 서비스는 추가하지 않는다. Node/pnpm/TypeScript 버전과 번들 방식은 구현 시 검증하며 현재 고정하지 않았다.
- 참고 작업 “ponytail 전역 설치”(019fe49c-b85d-7b92-b69e-b1cee92d0360)는 read_thread로 확인했다. 플러그인 설치 기록이며 ts-covi 요구사항 근거로 사용하지 않는다. 이번 세션에 제공된 Ponytail 지침을 적용한다.
- 테스트 규칙: 사용자 요청의 단계별 필수 검증과 Ponytail의 실행 가능한 최소 검증을 유지한다. 별도 TestCode PR은 추가 회귀 확장만 다루며 필수 검증을 보류하는 이유로 삼지 않는다.
- 실제 프로젝트 검증 대상은 M6에서 사용자가 지정한 읽기 권한 범위로 확정한다. 성능 목표치는 첫 측정 후 결정하며 아직 수치 보장은 없다.

산출물: [overview](architecture.html), [TaskList](plan.md#실행-tasklist), [실행 상태](checklist.md), [후속 회귀 확장](test-code-plan.md).

## 2026-09-20 구현 결과

- TypeScript 7.0.2는 패키지 루트에서 기존 Compiler API를 제공하지 않아 실제 검증 후 6.0.3으로 고정했다.
- 단일 패키지에 `src/model`, `src/analyzer`, `src/cli`, `src/ui`를 구현했다. DB·서버·workspace·schema framework는 추가하지 않았다.
- 독립 주문 fixture는 complete이며, ts-covi 자체 분석은 지원 경계 11개와 진단 46개가 있는 partial이다.
- 고정 commit `da62b8f`, Darwin 25.2.0 arm64, Node 22.16.0, pnpm 11.4.0, 7 files/1,331 LOC에서 분석 3회 중앙값 1.99s, peak RSS 중앙값 409,534,464 bytes, JSON 1,361,369 bytes였다. viewer 로딩 중앙값은 60.8ms였다.
- `file://` E2E에서 함수 탐색, 구조 블록, 내부 함수 펼침, 재귀 경계, 주석/인자/원문, partial·version 오류, 악성 HTML 텍스트 렌더링을 확인했다.


### Wecovi 읽기 전용 재확인

독립 탐색 결과의 주요 모델·주석·UI 코드를 직접 대조했다. `FlowContracts.kt`는 상대 경로/offset, formatVersion, targetSymbolId, boundaryKind를 제공하지만 함수 정의 테이블은 없다. `CoviMetadataIndexer.kt`는 주석이 있는 함수의 metadata를 추출하므로 ts-covi의 모든 함수 목록 정책은 별도 구현한다. `ui/src/main.tsx`의 재귀 카드와 aria-expanded는 참고하고 JCEF 메시지·요청 후 children 삽입은 가져오지 않는다. 참조 저장소 AGENTS.md는 해당 탐색에만 적용하며 기존 수정 파일을 보존했다.
