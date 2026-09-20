---
name: ts-covi-plan
description: TypeScript 정적 분석 CLI와 JSON 기반 Scratch 형태 HTML 뷰어의 단계별 구현 계획
created: 2026-09-20
status: complete
---

# ts-covi 개발 계획

먼저 [Architecture overview](architecture.html)를 읽고, 실행 상태는 [체크리스트](checklist.md)에서 확인한다. M1~M6 구현과 필수 검증을 완료했다.

## 최종 목표

로컬 TypeScript 프로젝트를 한 번 분석해 독립적인 JSON 스냅샷을 만들고, 사용자가 IDE나 서버 없이 HTML 뷰어에서 함수 내부의 순서·분기·반복·호출을 읽게 한다. 호출에 붙인 설명과 인자 표현식을 함께 표시하고, 확정 가능한 프로젝트 내부 호출은 클릭해 펼친다.

사용자는 함수 목록에서 시작 함수를 선택하고, 위에서 아래로 흐름을 읽고, 조건과 반복의 내부를 펼치고, 각 호출의 설명·인자·소스 위치를 확인한다. 원본 프로젝트가 없는 환경에서도 저장된 스냅샷을 읽을 수 있어야 한다.

### 최종 완료 조건

- TS/TSX 프로젝트를 대상으로 CLI 분석 → JSON 저장 → 로컬 HTML 열기 → JSON 선택 → 함수 탐색이 끝까지 동작한다.
- 순차 실행, 중첩 호출, 조건, 반복, 조기 종료, await, try/catch/finally가 지원 범위 안에서 올바르게 표현된다.
- 지원하지 않는 구문과 미해결 호출은 누락하거나 추측하지 않고 원문 및 이유를 표시한다.
- 호출 위치별 주석과 코드 인자 표현식을 분리해 보존하고 화면에 함께 표시한다.
- 내부 호출 펼치기, 재귀 경계, 원문 보기, 키보드 조작이 동작한다.
- fixture 기대 결과 및 실제 프로젝트 수동 확인을 통과한다. 분석/로딩 시간과 결과 크기를 측정해 기록한다.

## 범위와 정확성 원칙

첫 버전은 읽기 전용이다. JSON이 저장 형식이고 별도 DB/API 서버는 두지 않는다. 분석은 코드를 실행하거나 대상 프로젝트의 설정 스크립트를 실행하지 않는다.

- 정적 구조를 보여준다. 실행된 분기, 실제 인자 값, Promise 완료 순서와 실제 반복 횟수는 보여주지 않는다.
- 함수 호출 관계와 함수 내부 구조를 구분한다. 호출 관계만으로 실행 순서를 만들지 않는다.
- TSX 파일의 함수도 읽되 JSX는 첫 버전에서 원문을 가진 opaque 표현식으로 처리하고 내부 실행 구조를 보장하지 않는다.
- 동적 속성 호출, 런타임 DI, 다중 구현체와 외부 라이브러리에는 경계를 표시한다. 선언의 타입이 알려졌다는 이유만으로 런타임 구현을 확정하지 않는다.
- 콜백은 선언 위치에 본문이 있다는 이유로 즉시 실행 흐름에 끼워 넣지 않는다. 별도 함수 참조와 실행 시점 미확정 표시를 사용한다.
- 알 수 없는 구문은 `unsupported` 노드와 진단을 남긴다. 함수 전체 또는 문장을 조용히 버리지 않는다.

후속 범위: JavaScript 및 다중 언어 확대, SQLite, 감시 모드/증분 분석, 런타임 trace, AI 요약, 편집·소스 저장, IDE 통합, 자유 배치 그래프, 오염/데이터 의존성 분석. 실제 요구 또는 측정 결과가 생기면 추가한다.

## 구성과 구현 방법

```text
tsconfig.json / source files
  → 대상 파일 선택
  → TypeScript Program + TypeChecker
  → 함수·호출·제어 구조·주석 추출
  → 버전이 있는 JSON 스냅샷 검증 및 저장
  → HTML 파일 선택(File API)
  → 함수 목록 / 중첩 블록 / 인자·원문 패널
```

### 파일 수집과 파싱

- TypeScript Compiler API의 tsconfig 읽기/파싱 API로 compilerOptions, include/exclude, paths를 반영하고 Program을 만든다. noEmit으로 분석하며 대상 코드는 실행하지 않는다.
- Program이 해석에 필요로 하는 파일과 스냅샷에 포함할 소스를 구분한다. d.ts, node_modules, 생성 결과는 해석에 필요해도 함수 내보내기에서는 제외한다.
- 저장소 내부 소스만 내보내고 상대 경로를 저장한다. `.gitignore`와 분석 제외 규칙을 적용하되 tsconfig만으로 Git ignore가 적용된다고 가정하지 않는다. 대상 루트 밖으로 이어지는 심볼릭 링크는 내보내지 않는다.
- 처음에는 한 tsconfig 프로젝트를 지원한다. project references는 감지해 명시적인 미지원 진단을 반환한다. 묵시적으로 완전 분석했다고 표시하지 않는다.
- 함수 선언, 메서드, 함수 표현식, 화살표 함수에 snapshot 내 고유 ID를 만든다. 상대 경로+시작/끝 offset을 사용할 수 있으며 편집 후 ID 안정성은 보장하지 않는다.
- import alias와 직접 호출을 TypeChecker로 해석한다. 정적으로 구현을 특정할 수 있을 때만 targetFunctionId를 기록한다.

### 함수 내부 구조

AST visitor가 문장을 소스 순서로 읽되 표현식은 언어의 평가 규칙을 따른다. UI용 중간 표현은 `sequence / statement / call / branch / loop / break / continue / return / throw / try / unsupported`의 구조화된 트리로 둔다. 일반 선언·대입·증감은 원문을 가진 statement로 보존하고, break/continue에는 종료 또는 재진입 대상을 기록한다. 원시 CFG나 TypeScript AST 객체를 JSON에 그대로 저장하지 않는다.

- `outer(inner())`: inner 호출을 먼저 표현하고 outer의 인자 원문은 유지한다. AST 자식 나열이 항상 평가 순서라는 가정은 금지한다.
- `if`, 삼항식, `&&`, `||`, `??`, optional chaining은 실행 조건을 보존한다. 조건부 호출을 무조건 실행되는 블록으로 평탄화하지 않는다.
- for는 초기화 → 조건 → 본문 → 갱신 구조를 표현하고 while/do/for-of/for-in은 각 평가 위치를 구분한다. break/continue의 대상 및 label을 기록한다.
- return/throw 뒤 같은 경로의 문장을 정상 후속 단계로 연결하지 않는다. finally를 거치는 종료와 finally의 종료 덮어쓰기도 fixture로 검증한다.
- await는 호출 시작과 대기를 구분한다. Promise.all과 콜백은 실제 스케줄을 재현하지 않으며 호출 인자와 별도 함수 경계로 표시한다.
- generator/yield 등 아직 의미를 구현하지 않은 구문은 unsupported로 남긴다. 정확한 지원 범위를 버전과 함께 문서화한다.
- 모든 노드에 source span을 두어 원문과 결과를 대조할 수 있게 한다.

### JSON 계약

최상위: `formatVersion`, `producerVersion`, `project`, `files`, `functions`, `roots`, `diagnostics`, `coverage`.

| 데이터 | 필드와 역할 |
|---|---|
| project | 상대적인 표시 이름, 분석 옵션. 사용자 홈 등 절대 경로는 내보내지 않음 |
| files | 파일 ID, 상대 경로, contentHash, 원문 보기용 소스. 지원 범위 내 소스만 포함 |
| functions | ID, 이름, signature, source span, body의 구조화된 노드 |
| call | calleeExpression, args의 expression 원문, awaited, targetFunctionId 또는 boundary, annotation |
| branch / loop / try | 조건·본문·대안·반복/종료 대상을 타입별 필드로 표현 |
| source | fileId, start/end offset 및 표시용 line/column. offset은 UTF-16 기준, end는 exclusive |
| diagnostics / coverage | 누락·미지원·미해결 이유와 위치, scanned/analyzed/skipped 수, complete/partial 상태 |

함수 정의는 한 번만 저장하고 호출 노드는 ID로 참조한다. 함수 본문을 호출마다 복제하지 않는다. 블록의 children은 구문 중첩용이고 호출 펼치기는 함수 참조로 처리한다. 재귀로 스냅샷 크기가 무한히 커지지 않는다.

M1에서 작은 런타임 스키마를 확정하고 CLI 출력과 뷰어 입력이 같은 검증기를 사용한다. 유효하지 않은 노드 종류, 중복 ID, 끊어진 참조, 소스 범위, 지원하지 않는 버전은 거부한다. partial 결과는 명시적으로 표시한다.

### 주석 규칙

함수의 `@covi`, `@covi-root`, `@covi-group`은 Wecovi의 의미를 참고한다. 모든 지원 함수는 목록에서 선택 가능하고 `@covi-root`는 대표 진입점 표시 용도로 사용한다. `@covi-group`은 경로 문자열 메타데이터만 보존하며 그룹 탐색 UI는 후속 범위다.

호출 위치별 주석의 초기 문법:

```ts
// @covi-call {"label":"결제 승인","args":{"amount":"최종 결제 금액"}}
const paymentId = await chargePayment(token, amount);
```

- 같은 블록에서 공백만 사이에 있는 바로 다음 문장의 최상위 호출에 결합한다. 단일 변수 초기화/표현식/return의 호출과 await로 감싼 호출부터 지원한다.
- 최상위 후보가 여럿이거나 명확한 후보가 없으면 ambiguous/orphan 진단을 남기고 주석을 임의의 호출에 붙이지 않는다. 중첩 인자 호출은 최상위 후보에 포함하지 않는다.
- args는 인자 원문이 유일하게 일치할 때 설명을 결합한다. 중복 표현식, spread, 불일치 키는 주석을 보존하되 진단을 표시한다. 위치 기반 문법은 필요할 때 확장한다.
- 주석 JSON은 허용 필드와 타입을 검증한다. eval이나 코드 실행을 사용하지 않는다.
- label 우선순위: 호출 위치 주석 → 호출 대상 함수 설명 → 원래 callee 표현식.
- 주석 정보는 annotation, 코드 인자는 args로 분리한다. 주석 오류가 코드 구조를 바꾸지 않는다.

### CLI와 저장

예정 인터페이스: `ts-covi analyze --project ./tsconfig.json --out ./.covi/flow.json`.

기본 결과 위치는 `.covi/flow.json`. 출력 파일은 스캔 대상에서 제외한다. 같은 디렉터리의 임시 파일에 완성된 JSON을 쓰고 검증 후 rename하여 교체한다. 쓰기 실패 시 이전 결과를 보존한다. 대상을 심볼릭 링크로 따라가 덮어쓰지 않는다.

exit code는 0=분석 및 저장 완료, 1=설정/읽기/저장 등 치명적 실패, 2=결과는 저장했으나 partial로 정한다. 확정된 외부 라이브러리 호출과 재귀 경계는 정상 경계이므로 그 자체로 partial이 아니다. 분석 대상 구문 미지원, 파일 파싱 실패, 호출 대상 미해결/런타임 구현 미확정은 위치별 진단과 partial을 남긴다. complete는 정해진 분석 범위의 완전성을 의미하며 런타임 동작 증명을 뜻하지 않는다. 카운터 집계 규칙은 M1에서 고정한다.

### HTML 뷰어

- 기존 Wecovi의 React 중첩 카드 UI와 FlowDocument 개념을 참고한다. Kotlin PSI 분석기와 JCEF 브리지는 이식하지 않는다.
- 분석 모듈과 React 뷰어를 한 저장소의 `src/analyzer`, `src/model`, `src/cli`, `ui`로 분리한다. 처음부터 workspace 여러 패키지로 나누지 않는다.
- 빌드 결과는 JS/CSS를 포함하는 standalone `viewer.html`로 제공하고 `file://`에서 검증한다. JSON은 파일 선택/드롭의 File API로 읽는다. 옆 파일을 fetch하는 설계에 의존하지 않는다.
- 목록 → 함수 선택 → 중첩 블록 → 호출 펼치기 → 인자/원문 패널 흐름을 만든다. 펼친 호출의 조상 ID를 확인해 재귀 경계를 표시한다.
- 소스와 주석은 텍스트로 렌더링한다. 임의 HTML을 삽입하지 않는다. 파일 크기 제한, JSON 오류, 버전 오류, partial 상태를 사용자에게 표시한다.
- 외부 프로젝트가 없어도 저장된 원문을 볼 수 있다. IDE 원본 이동은 이후 연동 기능이다.
- 버튼, 키보드 포커스, 펼침 상태 aria 속성, 스크롤과 좁은 화면을 기본 지원한다.

## 설계 결정

| 영역 | 선택과 이유 | 차선책 및 미채택 이유 / tradeoff |
|---|---|---|
| 분석기 | TypeScript Compiler API: TS의 tsconfig·타입·import 해석 활용 | Tree-sitter는 다중 언어에 유리하지만 별도 의미 해석이 필요. TS 중심 범위를 먼저 검증 |
| 실행 환경 | M1에서 Node LTS와 pnpm 및 TypeScript 호환 버전을 확인 후 고정 | 최신 버전 무조건 추종은 API 변경 위험. 아직 패키지/lockfile은 없음 |
| 저장 | 버전 있는 JSON: CLI와 HTML 사이 가장 단순한 계약 | SQLite는 조회·부분 갱신이 병목으로 측정되면 도입. Sequelize는 저장 형식이 아닌 ORM |
| 화면 | 구문 트리 기반 중첩 블록 | 자유 배치 그래프는 순차 읽기 목적에 불필요한 배치 복잡도 |
| 불확실성 | 명시적 경계와 partial 진단 | 이름 기반 추측 연결은 읽는 사람에게 틀린 실행 흐름을 전달 |
| 배포 | 로컬 CLI + standalone HTML | 서버/IDE 결합은 설치와 공유 경로를 늘림. 파일 크기가 커지면 재검토 |
| 성능 | 전체 분석부터 시간/메모리/파일 크기를 측정 | 증분 캐시·워커는 의존성 무효화와 운영 복잡도. 병목 확인 후 도입 |

GitNexus에서는 수집→파싱→심볼 해석→적재의 분리와 CFG의 분기/종료 모델을 참고한다. 군집 분석, 그래프 DB, 임베딩은 도입하지 않는다. GitNexus 소스 직접 복제는 현재 라이선스를 별도로 검토하기 전 계획에 포함하지 않는다.

## 단계별 개발 순서

각 단계는 앞 단계의 fixture를 유지하고 완료 기준을 통과한 뒤 진행한다. 아래 명령은 M1에서 제공할 예정이며 현재는 실행할 수 없다.

| 단계 | 구현 작업 | 검증과 완료 기준 | 의존성 |
|---|---|---|---|
| M0 계획 | 저장소 초기화, 문서/범위 확정 | 계획·맥락·체크리스트 링크와 Git 상태 확인 | 없음 |
| M1 기반·계약 | 단일 패키지 TS CLI/뷰어 빌드 설정, JSON 타입·검증기, 수동 sample JSON, 최소 파일 선택 화면 | sample JSON으로 블록 1개 표시, 잘못된 버전/참조 거부, file:// HTML 로딩. test/typecheck/build 스크립트 제공 | M0 |
| M2 순차 분석 | tsconfig/ignore 수집, 함수 목록, 호출·변수 초기화·return·await, 직접 호출/alias 해석, CLI 저장 | outer(inner()) 순서, import alias, 한 줄 복수 함수 ID, 외부/미해결 경계, 저장 실패 시 이전 파일 보존 | M1 |
| M3 제어 구조 | if/삼항/단락/optional chaining, 반복, break/continue/label, try/catch/finally/throw 및 조기 종료 | 분기별 순서와 종료 경로 기대 JSON 비교. 콜백·generator 등 미지원 경계가 누락 없이 보임 | M2 |
| M4 주석·인자 | 함수 주석/대표 root와 call-site 주석, label 우선순위, args 설명, 주석 진단 | 잘못된 JSON·고아·모호한 주석·중복/spread 인자 fixture. 주석 전후 코드 구조 동일 | M3 |
| M5 탐색 UI | 함수 검색, 구조별 중첩 블록, 호출 펼치기, args/원문 패널, 재귀/partial UI, 접근성 | 순차·조건·반복·예외·재귀 sample을 file://에서 JSON 선택해 탐색. HTML 문자열이 실행되지 않음 | M4 |
| M6 실제 프로젝트 검증 | Wecovi 주문 예제를 참고한 독립 fixture와 실제 TS/NestJS 프로젝트 분석, 성능 측정, 사용 문서 | 아래 최종 검증 시나리오 통과, 지원/미지원 범위·측정 조건·수치 기록, clean install에서 재현 | M5 |

M2 끝에는 작지만 실제 소스에서 생성된 JSON을 보는 수직 흐름이 완성된다. M3~M5에서 정확성과 탐색 기능을 확장한다. M6까지가 첫 제품 버전의 완료 범위다.

## 검증 계획

- `pnpm test`: 작은 fixture의 의미 있는 기대 결과를 확인한다. snapshots만 저장하지 말고 순서, 조건부 실행, 종료 대상, 호출 해석, diagnostics를 assertion으로 확인한다.
- `pnpm typecheck`, `pnpm build`: CLI/model/viewer의 계약과 standalone 산출물을 검사한다.
- 수동 E2E: 외부 네트워크 없이 HTML 열기 → CLI 결과 선택 → 대표 함수 찾기 → 내부 호출 펼치기 → 인자/주석/원문 대조.
- 오류 E2E: JSON 문법 오류, 지원하지 않는 버전, 끊어진 ID, 악성 HTML 문자열, 큰 파일, partial 분석 결과를 명확하게 표시한다.
- 실제 예제: 주문 검증 → 재고 확보 → 금액 계산 → await 결제 → 저장 → await 알림 → return. 검증 함수의 if/throw, 금액 계산의 reduce 콜백 경계를 대조한다.
- 성능: 고정 머신/런타임/프로젝트 commit/파일 수/LOC를 기록하고 cold 3회 분석 및 뷰어 로딩의 중앙값, peak RSS, JSON 크기를 기록한다. 첫 측정 이후 목표치를 정하며 사전 성능 보장을 하지 않는다.
- 문서 수정 시 `git diff --check`와 상대 링크·frontmatter 검사를 실행한다.

## 남은 결정과 기본값

현재 문서는 사용자 요청에 따른 개발 초안이며 제품 구현은 시작하지 않았다. M1에서 런타임/Compiler API 버전과 실제 schema를 고정한다. 첫 지원 범위는 한 tsconfig와 TS/TSX, JSON, 읽기 전용 HTML로 둔다. 자동 캐시나 DB 추가는 측정 전 선행 조건으로 만들지 않는다.

관련 문서: [맥락](context.md), [체크리스트](checklist.md).


## 실행 TaskList

아래 경로는 생성 예정이며 현재 제품 코드가 있다는 뜻이 아니다. 각 단계는 구현 → 필수 검증 → 결과 기록 순서로 진행한다. 실패한 완료 기준은 다음 단계로 넘기지 않는다. 런타임과 패키지 버전은 M1.1에서 공식 지원 정보와 설치 환경을 확인해 고정한다.

| Task | 변경 대상과 결과 | 검증 방법 | 선행 작업 |
|---|---|---|---|
| M1.1 기반 | package.json, pnpm-lock.yaml, tsconfig*.json, 빌드 설정. Node/pnpm/TS 버전 및 test/typecheck/build 명령 고정 | 고정 버전 설치, typecheck/build가 실제 파일을 검사하는지 확인 | M0 |
| M1.2 JSON 계약 | src/model/: discriminated union, formatVersion, source span, coverage 집계 정의, 공용 입력 검증 함수 | 유효 sample 수락; 알 수 없는 kind/버전, 중복 ID, 끊어진 참조, 잘못된 범위 거부 | M1.1 |
| M1.3 최소 HTML | ui/, samples/minimal.json. File API로 JSON 선택, 검증 오류 또는 함수의 블록 하나 표시; JS/CSS 내장 dist/viewer.html | 네트워크 없는 file://에서 sample 로딩 및 오류 확인, test/typecheck/build | M1.2 |
| M2.1 수집·함수 색인 | src/analyzer/: tsconfig 읽기, ignore/경로 경계, 함수 ID, 파일 원문 저장 | include/exclude, 외부 symlink, references, 한 줄의 복수 함수, d.ts 제외 확인 | M1.3 |
| M2.2 순차 의미 | src/analyzer/: 선언·대입·증감·call·return·await, 직접/alias 호출 해석 | outer(inner()) 평가 순서, 콜백 본문 비삽입, 외부/미해결 경계 확인 | M2.1 |
| M2.3 CLI 저장 | src/cli/: analyze 인자, 검증 후 임시 파일 rename, exit 0/1/2 | 실제 TS → JSON → HTML; 저장 실패 시 이전 결과 유지, 출력 symlink 거부 | M2.2 |
| M3.1 조건·반복 | src/analyzer/, src/model/: 조건부 표현식, loop 위치, break/continue/label 대상 | 조건부 호출이 평탄화되지 않고 반복 위치·종료 대상이 보존되는지 fixture 대조 | M2.3 |
| M3.2 예외·종료 | src/analyzer/: throw/try/catch/finally, 종료 경로 및 미지원 진단 | finally 종료 덮어쓰기, return 이후 연결 차단, generator 경계 확인 | M3.1 |
| M4.1 주석 | src/analyzer/: 함수 metadata, call-site JSON 파싱·결합, args 설명 분리 | 고아/모호/잘못된 JSON/중복/spread, 주석 전후 구조 불변 검증 | M3.2 |
| M5.1 탐색 | ui/: 검색·선택, 구조별 중첩 블록, 내부 함수 펼침·재귀 경계, 원문/인자 패널 | 분기·반복·예외·재귀 sample 탐색, label 우선순위 확인 | M4.1 |
| M5.2 입력·접근성 | ui/: partial/용량/오류 안내, 텍스트 렌더링, 포커스·aria | 악성 HTML 비실행, 키보드 탐색, 좁은 화면 및 file:// E2E | M5.1 |
| M6.1 실사용 검증 | fixtures/, README.md, 검증 기록. 독립 주문 예제 및 사용자가 지정한 실제 TS/NestJS 프로젝트 | 원문 수동 대조; 환경·commit·LOC·cold 3회 중앙값·peak RSS·크기 기록 | M5.2 |
| M6.2 인수 | README.md, checklist.md: 지원 범위·명령·잔여 위험 | clean install부터 CLI/HTML까지 재현, 사용자 피드백 반영, commit/PR 준비 점검 | M6.1 |

M1에서는 전체 분석기나 모든 UI를 미리 구현하지 않는다. JSON의 노드 종류별 최소 구조와 참조 규칙을 먼저 고정하고, M3에서 구문 의미를 추가할 때 계약 변경이 필요하면 formatVersion 변경 여부를 판단한다. M2까지 실제 소스에서 화면까지 이어지는 수직 흐름을 우선 완성한다.

### 필수 검증과 후속 TestCode의 경계

사용자가 각 단계의 완료 기준 검증을 요청했으므로 기존 fixture/assertion과 계약 테스트는 단계의 필수 작업으로 유지한다. 비자명한 로직에는 실행 가능한 최소 검증을 남긴다. 테스트 프레임워크·fixture 체계 확장을 선행 조건으로 추가하지 않는다. TaskPlan의 후속 TestCode 분리 규칙은 **필수 검증 외 추가 회귀 테스트 확장**에 적용하며 [별도 계획](test-code-plan.md)에서 관리한다. 해당 후속 작업은 원본 완료와 commit/PR 준비 이후 사용자가 요청할 때만 진행한다.

## 재사용 및 함수화 결정

| 대상 | 사용 지점 / 입력 | 결합도와 선택 | 대안·tradeoff 및 재검토 조건 |
|---|---|---|---|
| JSON 검증 함수 | CLI 출력·HTML 입력 / unknown JSON 값 | 지금 공용화. TS/React/파일 시스템에 의존하지 않도록 src/model에 배치 | 두 검증기 복제는 계약 불일치 위험. 거대한 범용 schema framework는 필요하지 않음 |
| source span 변환 | 분석 visitor / SourceFile와 시작·끝 offset | 지금 함수화. UTF-16과 line/column 변환 규칙을 한 곳에서 유지 | 호출마다 계산하면 범위 오류가 반복됨. snapshot 안정성은 편집 전후까지 보장하지 않음 |
| 호출 대상 해석 | call visitor / TS checker와 call node, 함수 ID 색인 | 분석 모듈 내부 함수로 유지. checker를 UI나 JSON으로 전달하지 않음 | 범용 resolver interface는 단일 구현에 불필요. 두 번째 언어가 실제 범위가 되면 재검토 |
| 블록 렌더링 | 함수 본문·분기·반복·호출 펼침 / node와 현재 조상 함수 ID | 재귀 렌더러 재사용. UI 상태는 ui 내부에 유지 | AST/분석기 객체를 넘기지 않음. 큰 트리 최적화는 M6 측정 후 판단 |
| 원자적 저장 | CLI / 출력 경로와 검증된 JSON | src/cli 내부에 유지. 단일 저장 흐름에 repository 계층 불필요 | 실제 두 번째 저장 소비자가 생기면 추출. 실패 시 이전 파일 보존은 생략하지 않음 |
| 캐시·플러그인·DB 계층 | 현재 확정 사용처 없음 | 보류 | 병목 또는 실제 두 번째 구현이 확인될 때 다시 설계 |

## 계획 확인과 구현 시작

이 계획 검토 후 사용자 구현 요청을 받으면 M1.1부터 시작한다. 계획 확인은 전체 설계 검토용이며 각 Task마다 반복 승인을 요구하지 않는다. 구현 중 범위가 크게 바뀌는 결정만 다시 확인한다. 커밋·원격 생성·PR·배포는 이번 계획 작성에 포함하지 않는다.
