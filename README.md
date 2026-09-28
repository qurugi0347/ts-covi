# ts-covi

TypeScript 프로젝트를 실행하지 않고 정적 분석해 JSON으로 저장하고, standalone HTML에서 함수 내부의 순서·분기·반복·예외를 중첩 블록으로 읽는 도구다.

## 요구 환경

- Node.js 22.16 이상
- pnpm 11.4.0
- TypeScript Compiler API 6.0.3 (lockfile로 고정)

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

## 사용법

다른 로컬 저장소에서도 `ts-covi` 명령을 사용하려면 이 저장소에서 한 번 설치한다.

```bash
pnpm install --frozen-lockfile
pnpm install:global
```

이 설치는 현재 checkout을 전역 pnpm 명령에 연결한다. ts-covi 코드를 변경한 뒤에는 `pnpm install:global`을 다시 실행한다. 제거는 `pnpm remove --global ts-covi`로 한다.

프로젝트의 `tsconfig.json`을 분석한다. 기본 출력은 프로젝트 루트의 `.covi/flow.json`이다. 상대 `--out` 경로도 현재 작업 디렉터리가 아니라 `tsconfig.json`이 있는 프로젝트 루트를 기준으로 해석한다.

```bash
pnpm analyze --project ./tsconfig.json --out ./.covi/flow.json
open ./.covi/index.html
```

CLI는 프로젝트 루트의 `.covi/flow.json`과 `.covi/index.html`을 함께 만든다. `index.html`에는 같은 분석 스냅샷이 안전하게 포함되므로 `file://`로 바로 열면 별도 JSON 선택 없이 결과가 표시된다. 별도 서버 없이 함수 검색, 중첩 블록, 내부 함수 펼치기, 인자·주석·원문을 탐색할 수 있다.

뷰어는 탐색·흐름·상세 3단을 화면 높이 전체에 표시한다. 두 경계를 드래그하거나 키보드 방향키(Shift를 누르면 더 크게 이동, Home/End는 양 끝, Enter는 초기 너비)로 조절할 수 있다. 각 패널은 독립적으로 스크롤하며, 좁은 화면에서는 세로로 이어진다. 조절한 너비는 현재 탭에서 유지되고 새로고침하면 초기화된다. 부분 분석 상태는 탐색 영역에 표시하며 자세한 진단은 생성된 `flow.json`에 남는다.

배포된 CLI 형태의 인터페이스는 다음과 같다.

```bash
ts-covi analyze --project ./tsconfig.json --out ./.covi/flow.json
```

대상 저장소 루트에서 실행하면 `.covi/flow.json`과 `.covi/index.html`이 생긴다. 분석 결과가 partial이면 파일을 정상 생성한 뒤 종료 코드 `2`를 반환하므로 package script나 CI에서는 이를 구분해야 한다.

종료 코드는 `0`=complete 저장, `1`=설정·읽기·저장 실패, `2`=partial 저장이다. 출력은 같은 디렉터리의 임시 파일을 검증한 뒤 교체하며, 실패하면 이전 파일을 보존한다. symlink 출력은 교체하지 않는다.

## 지원 범위

- TS/TSX 단일 tsconfig 프로젝트
- 함수 선언, 메서드, 함수 표현식, 화살표 함수
- 변수 초기화, 대입·증감, 호출, 중첩 호출, return, throw, await
- if, 삼항식, `&&`, `||`, `??`, optional chaining
- for, for-of, for-in, while, do와 break/continue/label
- try/catch/finally와 finally 종료 덮어쓰기
- 직접 호출과 import alias, 외부·미해결·런타임 경계
- `@covi`, `@covi-root`, `@covi-group`, 바로 다음 문장의 `@covi-call` JSON
- NestJS controller/method decorator와 Express app/Router endpoint
- React Router route object·`Routes`/`Route` JSX 페이지
- Vue Router route와 저장소 내부 `.vue` 원문

뷰어는 기본적으로 API·페이지·수동 진입점을 그룹별로 보여 주며, `파일 탐색` 모드에서 폴더 → 파일 → 클래스 → 함수 계층으로 탐색할 수 있다. endpoint의 middleware/handler와 페이지의 component/loader/action은 각각 별도 대상으로 표시한다. package script와 bin은 진입점으로 만들지 않는다.

뷰어에서 긴 인자와 전체 시그니처는 오른쪽 상세에서 확인한다. AST로 확인된 단일 호출의 선언·반환·예외는 한 단계로 표시하고, 분기는 주석 설명 또는 조건 원문을 제목으로 보여 준다. 긴 분기·반복·예외 본문은 요약 상태에서 시작하며 `본문 펼치기`로 확인한다. 접힌 요약에도 종료·외부/미해결 경계와 catch/finally가 남는다.

내부 호출을 선택하고 오른쪽 상세의 `함수 자세히 보기`를 누르면 중앙에서 해당 함수를 보여 준다. 함수 자세히 보기는 해당 호출의 인라인 본문도 함께 펼친다. `+`로도 인라인 본문을 펼칠 수 있다. 재귀 호출은 경계로 표시한다.

함수 상세는 시그니처를 항상 표시하며 별도 반환 타입 영역은 두지 않는다. 인자는 매개변수 이름 아래 실제 전달 표현식을 표시한다. 설명은 호출 위치의 `@covi-call` 인자 설명을 우선하며, 없으면 매개변수의 JSDoc `@param` 설명을 사용한다. 이름이나 설명을 해결하지 못하면 추정하지 않는다. 이전 JSON에는 이 정보가 없을 수 있으므로 다시 분석한다.

현재 함수 ID는 URL의 `fn`, 탐색 모드·검색·선택·펼침·호출 경로는 `view`에 저장된다. 새로고침하거나 URL을 다시 열어 현재 화면을 복원할 수 있다. 함수 이동은 브라우저 뒤로가기·앞으로가기로 되돌리며, 검색·선택·펼침 조작은 이력 항목을 늘리지 않는다. 경로의 `돌아가기`는 호출한 상위 함수로 이동한다. 이전 화면의 펼침·스크롤은 해당 브라우저 이력 안에서 복원되며, 공유 링크에서는 이전 화면의 기본 상태를 사용한다. 검색어도 URL에 포함되므로 링크 공유 시 확인한다. 잘못되었거나 오래된 ID는 유효한 기본 화면으로 복원하며 안내를 표시한다. 모든 `<details>` 접힘 상태와 공유 링크의 정확한 스크롤 위치는 저장하지 않는다.

새로운 문장 통합과 표현식 분기 표시는 다시 분석한 JSON에 적용되며, 이전 JSON도 기존 구조로 열 수 있다.

`if`의 `&&`·`||` 조건은 원문의 줄바꿈을 유지해 한 BRANCH로 표시한다. 앞 조건의 참/거짓에 따른 개별 평가 순서와 조건 내부 호출은 별도 카드로 펼치지 않는다. `(location === 'ko' && age > 19)`처럼 비교식을 한 줄에 묶어 작성하면 그 그룹을 그대로 읽을 수 있다.

`location === 'ko' && doSomethingOnKo()`처럼 논리 연산자로 조건부 실행하는 호출의 개별 흐름 시각화는 지원하지 않는다. 조건 원문은 표시하지만 실행 여부·결과를 추정하지 않는다. 호출 흐름을 탐색하려면 `if (location === 'ko') { doSomethingOnKo(); }`처럼 본문으로 분리한다. 분석 JSON은 기존 평가 정보를 보존한다.

함수 정의는 `functions`에 한 번 저장하고 호출은 ID로 참조한다. 주석 설명과 코드의 인자 표현식은 별도 필드다. 알 수 없는 구문과 호출은 원문·위치·진단을 남기며, 실제 분기 결과·인자 값·반복 횟수·Promise 완료 순서를 추측하지 않는다.

런타임 route 등록, NestJS global prefix/version, 동적 Express mount, lazy route factory는 partial로 남긴다. Vue SFC는 페이지 원문만 연결하며 내부 함수 흐름은 분석하지 않는다. 실제 middleware 완료 순서, React 렌더링/effect, 비동기 callback 완료 시점은 추측하지 않는다.

그 밖의 현재 경계는 project references, generator/yield 의미, 동적 속성 호출, 런타임 DI와 다중 구현체다. 일반 JSX는 opaque 표현식으로 남는다. SQLite, 증분 분석, 런타임 trace, AI 설명, IDE 통합은 포함하지 않는다.

## Covi 주석

```ts
/**
 * 주문 생성 흐름
 * @covi-root
 * @covi-group order/create
 */
async function createOrder(token: string, total: number) {
  // @covi-call {"label":"결제 승인","args":{"token":"결제 토큰","total":"주문 합계"}}
  await approvePayment(token, total);
}
```

`@covi-call`은 공백만 사이에 둔 바로 다음 문장의 최상위 호출 하나에만 결합한다. 잘못된 JSON, 고아·모호한 대상, 중복 표현식과 spread 인자는 임의로 연결하지 않고 진단한다.

## 검증과 측정

2026-09-20, `da62b8f`, Darwin 25.2.0 arm64, Node 22.16.0, pnpm 11.4.0, TypeScript 6.0.3에서 측정했다. 대상은 이 저장소의 7개 TypeScript 파일, 1,331 LOC다.

| 항목 | 결과 |
|---|---:|
| 분석 3회 | 1.99s / 1.98s / 2.00s |
| 분석 중앙값 | 1.99s |
| peak RSS 중앙값 | 409,534,464 bytes |
| JSON 크기 | 1,361,369 bytes |
| viewer 로딩 3회 | 107.4ms / 60.1ms / 60.8ms |
| viewer 로딩 중앙값 | 60.8ms |

자체 분석 결과는 170개 함수, supported 1,478개, unsupported 11개, 진단 46개로 partial이었다. `fixtures/order`는 순차 호출·검증 if/throw·reduce callback 경계·await 호출·저장·알림·return을 독립적으로 검증하며 complete 결과를 만든다.

### 파일 탐색

진입점 옆 **파일 탐색** 탭에서 폴더 → 파일 → 클래스 → 메서드 순서로 펼쳐 함수를 선택합니다. 일반 함수는 파일 아래 표시합니다. 파일 경로·클래스·함수 이름으로 검색할 수 있으며 선택한 함수의 경로는 자동으로 펼칩니다. 클래스 정보가 없는 이전 JSON은 다시 분석해야 클래스별로 묶입니다.

클래스 이름을 선택하면 중앙에 **클래스 개요**가 열립니다. 화살표는 메서드 목록만 펼치거나 접습니다. 개요에는 소스 설명·상속/구현 원문·필드·생성자 인자·직접 선언 메서드 시그니처를 표시합니다. 메서드의 **함수 흐름 보기**로 기존 블록 화면에 들어가고, 상단 소유 클래스 경로로 개요에 돌아올 수 있습니다.

클래스 선택은 `?class=<classId>`에 저장되어 새로고침·브라우저 뒤로가기·앞으로가기에 복원됩니다. 기존 함수 링크도 유지합니다. 클래스 ID는 파일과 선언 위치를 기반으로 하므로 코드 변경 후 이전 링크가 유효하지 않으면 안내 후 기본 화면으로 돌아갑니다.

이전 JSON에 `classes`가 없으면 기존 함수 탐색은 유지하며 클래스 개요를 위한 재분석을 안내합니다. 생성자·getter/setter·본문 없는 메서드는 선언 정보와 원문만 표시합니다. 상속받은 메서드·생성자 실행 흐름·DI의 실제 연결·클래스 호출 그래프는 분석하지 않습니다. 메서드 목록의 선언 순서는 실행 순서를 의미하지 않습니다.
