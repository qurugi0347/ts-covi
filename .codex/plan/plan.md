---
name: ts-covi-entrypoints-plan
description: endpoint·페이지·스크립트 중심 탐색 구현 계획
created: 2026-09-21
status: draft
---

# 진입점 중심 탐색 구현 계획

[Architecture](architecture.html) → [맥락](context.md) → [체크리스트](checklist.md). 이전 M1~M6 완료 기록은 [보관 문서](completed-v1/plan.md)에 유지한다. 이번 요청은 계획 작성이며 제품 구현·commit·push는 포함하지 않는다.

## 목표와 완료 조건

함수 검색 위치에서 API endpoint·페이지·스크립트·수동 진입점을 먼저 선택하고 해당 함수의 기존 중첩 블록으로 이동한다. 전체 함수 검색은 별도 모드로 유지한다. NestJS, Express, React Router, Vue Router의 아래 명시된 정적 선언 범위를 단계적으로 지원한다.

- 신규 JSON과 기존 v1 JSON 모두 읽는다. 같은 함수에 연결되는 복수 URL은 각각 선택할 수 있다.
- 경로·HTTP method·라벨·함수명으로 검색하고 API/페이지/스크립트/수동 그룹으로 탐색한다.
- 확정되지 않은 경로·handler·component는 원문 위치와 미해결 사유를 표시한다. 호출되지 않는 함수를 자동 진입점으로 만들지 않는다.
- .covi/flow.json + 내장 스냅샷 index.html 생성, 파일 교체, partial/exit 2 계약을 유지한다.
- Vue 페이지 발견과 Vue 함수 블록 분석을 구분한다. .vue 페이지는 목록과 안전한 원문 보기까지 완료 기준이며 함수 내부 분석은 후속 범위다.

## 범위

| 대상 | 이번 정적 지원 | 명시적 한계 |
|---|---|---|
| 스크립트 | 프로젝트 루트 package.json scripts의 단순 tsx/ts-node 명령, TS/TSX bin, 반복 가능한 --entry 파일 지정 | shell compound/env expansion/동적 명령, JS→TS sourcemap, import 초기화 순서는 후속 |
| 수동 | 기존 @covi-root + @covi-group | 새 주석 언어/설정 파일은 만들지 않음 |
| NestJS | @nestjs/common import/alias를 확인한 Controller + HTTP method decorator, 문자열/문자열 배열 경로 | 런타임 DI, global prefix/version/host/module mount는 미해결 시 부분 경로로 표시; 배포 URL이라고 단정하지 않음 |
| Express | express app/Router 생성과 import alias 추적, get/post/put/patch/delete/options/head/all, route(path).get(...), 정적 use(prefix, router), 명시적 다중 handler | 동적 mount·조건부 등록·정규식/계산 경로는 미해결. 미들웨어 실행 순서나 next 호출 결과는 추정 안 함 |
| React Router | react-router / react-router-dom의 createBrowserRouter·createHashRouter·useRoutes 정적 route object 및 Routes/Route JSX, path/index/children, Component/element | React 자체는 페이지 규칙 없음. Next/TanStack Router/자동 파일 라우팅은 후속 |
| Vue Router | createRouter({routes}), 정적 path/children, component 및 정적 import('./Page.vue') | Vue SFC template/setup 흐름은 미지원. Nuxt/동적 라우트 등록은 후속 |

상수 해석은 문자열 리터럴, 치환 없는 template literal, const alias/import 재참조, 정적 배열/객체만 지원한다. 순환 alias는 visited 집합으로 종료한다. 함수 호출·환경 변수·사용자 설정 스크립트는 실행하지 않는다. import 이름만 같은 사용자 함수는 framework API로 오인하지 않도록 import 원본을 확인한다. 패키지 탐지는 후보를 좁히는 용도이며 등록 선언이 실제 근거다.

## JSON 계약과 데이터 흐름

기존 formatVersion 1에 선택적 entrypoints를 추가한다. 기존 파일의 필드 부재는 허용한다. 새 validator가 필드를 검사하고 반환 객체에 보존하도록 CLI와 UI 공용 검증기를 함께 수정한다. 기존 뷰어는 추가 정보를 무시하고 전체 함수로 읽는 호환성을 유지한다. producerVersion은 구현 시 갱신한다.

```ts
type EntryPoint = {
  id: string;
  kind: 'endpoint' | 'page' | 'script' | 'manual';
  framework?: 'nestjs' | 'express' | 'react-router' | 'vue-router';
  label: string;
  path?: string;
  method?: string;
  source?: SourceSpan; // 라우트/주석 위치; 경로만 아는 script는 없을 수 있음
  command?: string; // package.json의 원문 명령, 실행하지 않음
  origin?: { kind: 'package-script' | 'bin' | 'explicit'; name: string };
  targets: Array<{
    role: 'handler' | 'middleware' | 'component' | 'loader' | 'action' | 'module';
    functionId?: string;
    moduleId?: string; // 파일 최상위 실행 단위 참조
    source?: SourceSpan; // Vue 원문 등 함수가 없는 대상
    expression: string;
    status: 'resolved' | 'partial';
    reason?: string;
  }>;
  status: 'resolved' | 'partial';
  reasons: string[];
};
```

- endpoint가 여러 handler를 등록하면 targets에 등록 순서와 역할을 보존하되 합성 sequence 블록으로 만들지 않는다. 역할을 확정할 수 없으면 handler로 표시한다.
- 페이지 component·loader·action도 별도 대상으로 선택한다. effect·event·자식 렌더링을 동기 호출처럼 연결하지 않는다. React JSX는 현재 opaque 경계를 유지한다.
- source/target source는 files의 실제 ID와 원본 offset을 참조한다. 최소 functionId, moduleId 또는 source가 있는 대상만 resolved 가능. .vue 원문만 연결된 대상은 partial과 SFC 분석 미지원 사유를 유지한다.
- functionId가 있으면 functions 내 존재를 검사한다. id 중복, kind/framework/role/status enum, method(HTTP method 또는 ALL), path 문자열, source span, partial reasons를 검증한다. 각 target partial에는 reason이 필요하며 하나라도 partial이면 entry도 partial이어야 한다. resolved entry는 비어 있지 않은 targets와 확정된 endpoint/page 경로를 요구한다. endpoint에는 method를 필수로 요구한다. manual에는 framework/path/method를 요구하지 않는다. script는 framework/method 없이 origin을 필수로 가지며 resolved이면 실제 moduleId 대상과 프로젝트 상대 파일 path가 필요하다. source는 script 이외에는 필수다. script unresolved는 source 없이 command/origin/reasons로 설명할 수 있다. functionId와 moduleId는 동시에 지정하지 않으며 moduleId는 modules 내 실제 ID를 검증한다. broken reference는 입력 오류로 거절한다.
- ID는 등록 소스 위치 + method/path 전개 + mount 위치 + target 순번을 기준으로 snapshot 내 결정적으로 생성한다. 소스 정렬을 고정한다. 동일 URL 충돌은 서로 덮어쓰지 않고 두 등록 위치를 표시한다.
- roots는 기존 수동 주석 의미를 유지한다. roots를 manual entry로 변환하며 같은 함수가 자동 entry에 있어도 사용자가 붙인 수동 그룹을 보존한다. 기존 JSON은 roots로 화면용 entry를 구성한다.
- 함수 인덱스 구성 → framework 등록 위치 탐지 → 상수·import·mount·target 연결 → entrypoints 생성 → 공용 검증 → 기존 CLI 저장 → UI 선택 순서다. 기존 Program/Checker와 함수 ID map을 재사용하고 framework별 Program을 다시 만들지 않는다.
- Vue import 대상은 라우트에 명시된 저장소 내부 .vue만 추가 읽기한다. realpath·루트 내부·ignore 규칙을 동일 적용하고 원문/hash/source span을 files에 기록한다. 외부 경로·symlink 탈출·없는 파일은 읽지 않고 부분 결과로 남긴다. files의 scanned/analyzed/skipped를 기존 validator 불변식에 맞추며 Vue 원문 포함을 함수 분석 완료와 혼동하지 않는다.
- 새 미지원 등록은 diagnostics에 ENTRYPOINT_UNRESOLVED 등을 추가하여 기존 partial 및 종료 코드 2에 반영한다. framework가 없는 프로젝트는 그 자체로 partial이 되지 않는다. TS2307 등 .vue 관련 기존 compiler 진단은 숨기지 않는다.

## 스크립트 진입점과 최상위 실행 단위 — S1

- 자동 탐지는 분석 프로젝트 루트의 package.json만 읽는다. scripts에서 `tsx scripts/seed.ts`, `ts-node scripts/job.ts` 형태의 단일 실행 명령(따옴표로 감싼 파일 경로 및 파일 뒤의 리터럴 인자 포함)만 우선 해석한다. runner 앞의 env assignment, 옵션, `&&`, `|`, `;`, redirection, 명령/변수 치환, pnpm script 재귀 참조는 실행/추정하지 않고 script 항목에 partial 사유를 남긴다. 명령은 shell에 전달하지 않는다.
- bin은 문자열/이름→경로 객체에서 직접 TS/TSX 파일을 가리킬 때만 분석한다. JS 빌드 산출물, 외부 실행 파일, 누락 파일은 원문 경로와 partial 사유를 표시한다. JS를 지원한다고 가장하지 않는다.
- CLI에 반복 가능한 `--entry ./scripts/job.ts`를 추가한다. 경로 기준은 --project tsconfig 디렉터리이며 자동 탐지와 병합한다. 자동/명시 경로 모두 realpath, 프로젝트 루트, ignore, 확장자를 검사한다. tsconfig include 밖의 적격 TS/TSX는 Program 생성 전에 rootNames에 추가하고 기존 compilerOptions를 적용한다. 이 파일로부터 import된 소스는 기존 수집 규칙을 적용한다. 사용자가 명시한 파일 경로의 오류는 CLI exit 1, 자동 발견 경로의 실패는 partial이다.
- 새 `FlowDocument.modules?`는 `{id, source, body: SequenceNode}` 배열이다. 확정한 script 파일당 `module:<relative-path>` 단위 하나를 만들고 entry target의 moduleId로 연결한다. 같은 파일의 scripts 별칭/bin/명시 항목은 각각 entry를 보존하되 module body는 중복 저장하지 않는다. script entry ID는 origin kind/name + 파일 경로로 구분한다.
- 기존 analyzeStatements에 SourceFile.statements를 전달하도록 필요한 부분만 확장한다. 변수 초기화·최상위 if/loop/await·직접 호출·IIFE 호출 위치를 분석한다. 함수 선언은 별도 functions에 유지하고 그 본문을 최상위에 중복 삽입하지 않는다. import/export의 module 로딩 효과 및 class static 초기화 등 미지원 효과는 원문 경계와 진단을 남긴다. import를 조용히 '아무 동작 없음'으로 표시하지 않는다.
- 기존 node renderer를 modules.body에도 재사용한다. main()에서 targetFunctionId로 함수 본문을 펼친다. 실제 argv 값, require.main 조건의 결과, 비동기 callback 완료 시점은 추정하지 않는다. module source span과 내부 node ID도 중복/참조 검증 대상이다. module body는 함수와 동일한 전역 nodeIds/referencedFunctions 검증에 참여한다. roots/targetFunctionId는 함수 전용으로 유지하며 module ID를 넣지 않는다.
- v1 호환: modules 없는 구형 입력 허용, 새 validator 반환부에서 modules 보존. functions/roots와 기존 함수 coverage 수치는 유지한다. 새 선택적 moduleCoverage `{analyzed, nodes: {supported, unsupported}}`를 modules와 함께 생성하고 별도로 집계·검증한다. modules 존재 시 moduleCoverage 필수; analyzed는 modules.length, 노드 집계 규칙은 기존과 동일. 기존 coverage.status는 함수/모듈/진입점 진단 모두 반영한다. 구형 UI는 모듈을 무시하므로 스크립트 전용 파일이 안 보이는 한계를 README에 명시한다.
- package.json은 origin 메타데이터만 읽고 files에 TS 소스처럼 추가하지 않는다. 명령 원문은 사용자 스냅샷 데이터로 포함되므로 README에 포함 범위를 안내한다. 모든 실패 항목에 가짜 SourceSpan을 만들지 않는다.

## UI 동작

진입점 / 전체 함수 모드를 제공한다. 진입점이 있으면 기본 진입점 모드, 없으면 전체 함수와 '발견된 진입점 없음 · @covi-root로 지정 가능' 안내를 보인다. 검색 0건과 진입점 0건을 구분한다. entrypoints 부재는 구형 JSON으로 안내하고 roots에서 수동 목록을 구성한다. entrypoints=[]는 신규 분석의 탐지 0건이며, 신규 생성기는 roots가 있으면 manual entry를 반드시 포함한다.

진입점 검색은 label/path/method/framework/command와 대상 함수명에 적용한다. endpoint는 controller/등록 파일, page는 경로, script는 package script/bin/명시 파일과 상대 파일 경로, manual은 groupPath로 그룹화한다. 내부 중첩 라우트 경로를 조합하며 index 및 pathless layout은 별도 라벨로 구분한다. unresolved 경로는 실제 URL처럼 보이지 않게 원문/부분 경로 배지를 붙인다.

selectedEntryPointId, selectedTargetIndex, selectedFunctionId를 분리해 동일 함수의 여러 URL을 선택해도 선택 표시가 유지되게 한다. script module은 selectedModuleId로 선택하며 함수 선택과 상호 배타적으로 초기화한다. 진입점 선택 시 targets 목록을 보여 주고 첫 해석된 주 대상 함수로 연결한다. 함수와 module이 모두 없으면 등록 위치와 원문을 보여 주며 이전 함수 블록은 지운다. source-only 또는 미해결 대상끼리도 selectedTargetIndex로 구별하며 진입점 변경 시 대상 index를 초기화한다. JSON 교체 시 검색·선택·펼침 상태를 초기화한다. 전체 함수에는 기존 anonymous도 그대로 남긴다. 키보드/aria-pressed/포커스와 320px 화면을 확인한다.

## 설계 결정

| 선택 | 이유 | 차선책 | 미채택 이유 | tradeoff |
|---|---|---|---|---|
| 선택적 entrypoints | 기존 함수/ID 재사용, 복수 URL 허용 | 함수에 URL 필드 추가 | 한 함수 여러 등록 및 Vue 원문 대상 표현 부족 | validator/UI 선택 상태 추가 |
| script module 분리 | 파일 최상위는 함수 선언과 다름 | 가짜 함수로 저장 | 함수 개수와 의미 왜곡 | modules/선택 상태와 별도 coverage 필요 |
| v1 additive 확장 | 구형 스냅샷 계속 읽기 | 즉시 v2 전환 | 기존 필드 의미 변경 없음 | 구형 UI는 새 메타데이터 무시 |
| import 기반 정적 탐지 | 동명 일반 메서드 오탐 억제 | 이름 패턴만 검사 | 잘못된 endpoint를 만들 수 있음 | wrapper 라이브러리는 partial/manual 보완 |
| 명시적 다중 target | middleware/component/loader의 실행 시점 보존 | 합성 함수 본문 | 실제 순서를 오해시킴 | 대상 한 번 더 선택 |
| React Router부터 | 대표 선언 기반 페이지 경로와 연결 가능 | 모든 라우터 동시 지원 | 미확정 환경과 파일 규칙으로 범위 확대 | 다른 라우터 자동 지원은 보류 |
| Vue 페이지 원문까지 | 현 TS/TSX 분석기 경계를 명확히 유지 | SFC compiler 및 가상 TS 추가 | source map·template 실행 의미까지 별도 큰 작업 | Vue 블록은 다음 범위 |

## 재사용·함수화

| 대상 | 사용처 / 입력 | 선택 / 결합도·근거 |
|---|---|---|
| 함수 타겟 해석 | Nest/Express/React; expression, Checker, 함수 ID map | 기존 호출 해석을 먼저 검토하고 필요한 공통 부분만 추출. UI 객체 전달 없음 |
| 정적 문자열 해석 | 모든 detector; node, Checker, visited | 실제 복수 사용처가 있으므로 작은 순수 helper. 임의 interpreter로 확장 안 함 |
| URL 경로 조합 | Nest/Express/React/Vue; 경로 문자열 | 공통 slash 결합만 helper, pathless/index/ALL 의미는 detector에 유지. OS path.join 사용 안 함 |
| 탐지 orchestration | analyzeProject의 Program/파일/인덱스 | 명시적 함수 호출. plugin registry/interface/factory 불필요 |
| Vue source 포함 | 파일 수집 규칙 | 현재 경계 검사를 재사용; 새 저장소/DB 계층 없음 |
| 최상위 문장 분석 | 함수 body와 script; SourceFile/statements/분석 context | analyzeStatements와 블록 renderer 재사용, 함수 인덱스와 실행 단위는 구분 |
| 검색과 선택 | UI의 snapshot과 문자열/ID | UI 안에 유지. 성능 문제가 측정되기 전 검색 인덱스 라이브러리 없음 |

## TaskList

실행 순서는 E1 → E2 → S1 → E3 → E4 → E5 → E6 → E7 → E8이다. 기존 Task ID는 유지한다. 각 단계 구현 후 같은 행의 검증을 수행한다. TestCode 파일 작성/수정은 아래 별도 후속 PR로 분리한다. 원본 작업은 기존 테스트 실행 및 임시 디렉터리 최소 입력을 통한 CLI/JSON assertion·UI 수동 검증을 반드시 수행하고 명령/결과를 기록한다.

| Task | 변경 대상(예정) | 작업 | 의존성 | 완료 검증 |
|---|---|---|---|---|
| E1 | src/model/flow.ts, src/analyzer/analyze.ts | entrypoints 계약/검증, roots→manual 변환 | 없음 | 기존 sample + 신규/깨진 참조 JSON assertion |
| E2 | src/ui/main.tsx, styles.css | 모드/검색/그룹/다중 대상/미해결 원문 UI | E1 | 수동 entry·0건·동일 함수 복수 URL·JSON 교체·키보드/320px |
| S1 | src/cli/index.ts, src/model/flow.ts, src/analyzer/scripts.ts (신규 예정), analyze.ts, UI | package scripts/bin/--entry 탐지, modules·최상위 body·coverage·UI 연결 | E1–E2 | seed/bin/명시 파일, include 밖 입력, IIFE/await, 복수 별칭, 미지원 shell·경로 탈출·구형 JSON |
| E3 | src/analyzer/entrypoints.ts, nestjs.ts (신규 예정) | 공통 정적 해석 최소 함수와 Nest 탐지 | E1 | Get/Post + alias + prefix 미해결 + 동명 decorator 오탐 없음 |
| E4 | src/analyzer/express.ts (신규 예정) | app/Router/route/use/mount 및 targets | E3 공통 helper | 복수 mount·순환 mount·다중 handler·동적 경로 partial |
| E5 | src/analyzer/react-router.ts (신규 예정) | route object/JSX/pathless/index/import target | E3 공통 helper | nested route·Component/element·loader/action·lazy 미해결 표시 |
| E6 | src/analyzer/vue-router.ts (신규 예정), source 수집 | Vue route와 .vue 원문 연결 | E5 | 정적 dynamic import·nested 경로·source span·외부 경로 거절 |
| E7 | README.md, HANDOFF.md, 본 checklist | 통합 인수·범위 설명·측정 | E2, S1, E3~E6 | pnpm test/typecheck/build, compiled CLI→HTML, 원문 대조 |
| E8 | 제품 코드/문서 범위 | 사용자 확인·피드백 반영·commit/PR 준비 | E7 | 범위/잔여 gap 확인, 승인된 Git 작업만 실행 |

lazy 지원: 직접 문자열 import의 파일/선언을 정적으로 연결할 수 있으면 대상 source를 연결한다. factory 함수 실행 결과나 Promise 해석은 하지 않는다. 재수출/별칭으로 연결 불가면 partial. Express/Nest의 전역 등록 환경을 확정하지 못하면 등록 선언 후보임을 표시한다.

## 검증·측정과 후속 작업

E7은 구형 samples/minimal.json, 새 script/API/React/Vue 최소 프로젝트, 자체 분석을 대조한다. 분석 시간/peak RSS/JSON 크기를 변경 전후 동일 환경 3회 중앙값으로 기록한다. 성능 합격 수치를 사전에 발명하지 않고 의미 있는 회귀가 있으면 원인을 조사한다. 직접 file:// UI 검증이 도구 정책으로 막히면 미실행으로 기록하고 사용자 확인 대상으로 남긴다.

후속 TestCode PR은 [test-code-plan.md](test-code-plan.md)를 따른다. 기존 테스트 수정 없이 통과하지 못하는 호환성 문제는 테스트를 생략하지 말고 설계를 재검토한다. 추가 회귀 suite는 원본 작업 완료와 사용자 요청 후 진행한다.

다른 라우터, Vue SFC 블록, 프레임워크 전체 lifecycle/DI/guard 실행 순서, anonymous 자동 이름 개선은 후속 범위다. 현재 계획 승인은 이 범위 경계와 React Router 우선 선택에 대한 확인이며, 별도 설정/추상화를 미리 만들지 않는다.
