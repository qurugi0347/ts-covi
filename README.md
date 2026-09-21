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

CLI는 프로젝트 루트의 `.covi/flow.json`과 `.covi/index.html`을 함께 만든다. `index.html`에는 같은 분석 스냅샷이 안전하게 포함되므로 `file://`로 바로 열면 결과가 표시된다. 별도 서버 없이 함수 검색, 중첩 블록, 내부 함수 펼치기, 인자·주석·원문을 탐색할 수 있으며 파일 선택으로 다른 JSON을 열 수도 있다.

배포된 CLI 형태의 인터페이스는 다음과 같다.

```bash
ts-covi analyze --project ./tsconfig.json --out ./.covi/flow.json
```

대상 저장소 루트에서 실행하면 `.covi/flow.json`과 `.covi/index.html`이 생긴다. 분석 결과가 partial이면 파일을 정상 생성한 뒤 종료 코드 `2`를 반환하므로 package script나 CI에서는 이를 구분해야 한다.

tsconfig의 `include` 밖에 있는 실행 파일은 반복 가능한 `--entry`로 추가한다.

```bash
ts-covi analyze --project ./tsconfig.json --entry ./scripts/seed.ts --entry ./scripts/job.ts
```

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
- 프로젝트 루트 `package.json`의 직접 `tsx`/`ts-node` script, TS/TSX bin, `--entry` 실행 파일
- NestJS controller/method decorator와 Express app/Router endpoint
- React Router route object·`Routes`/`Route` JSX 페이지
- Vue Router route와 저장소 내부 `.vue` 원문

뷰어는 기본적으로 API·페이지·스크립트·수동 진입점을 그룹별로 보여 주며, `전체 함수` 모드에서 기존 함수 목록을 그대로 탐색할 수 있다. endpoint의 middleware/handler와 페이지의 component/loader/action은 각각 별도 대상으로 표시한다. 스크립트는 파일 최상위 실행 블록을 함수와 구분해 저장하고, 그 안의 정적 함수 호출은 기존 함수 블록으로 펼친다.

함수 정의는 `functions`에 한 번 저장하고 호출은 ID로 참조한다. 주석 설명과 코드의 인자 표현식은 별도 필드다. 알 수 없는 구문과 호출은 원문·위치·진단을 남기며, 실제 분기 결과·인자 값·반복 횟수·Promise 완료 순서를 추측하지 않는다.

복합 shell script, JS bin의 원본 역추적, 런타임 route 등록, NestJS global prefix/version, 동적 Express mount, lazy route factory는 partial로 남긴다. Vue SFC는 페이지 원문만 연결하며 내부 함수 흐름은 분석하지 않는다. package script 원문은 JSON 스냅샷에 포함된다. 실제 middleware 완료 순서, React 렌더링/effect, 비동기 callback 완료 시점은 추측하지 않는다.

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

2026-09-21에는 같은 Darwin/Node/pnpm 환경에서 `main` 2743e1a와 진입점 구현을 각각 3회 자체 분석했다. 중앙값 기준 분석 시간은 1.78s → 1.94s, peak RSS는 442,499,072 → 455,540,736 bytes, JSON은 2,055,004 → 3,368,483 bytes였다. JSON 증가는 스크립트 모듈과 진입점 메타데이터, 새 분석기 소스 자체가 스냅샷에 포함된 결과다.

계획과 검증 근거는 [구조 개요](.codex/plan/architecture.html), [개발 계획](.codex/plan/plan.md), [작업 맥락](.codex/plan/context.md), [체크리스트](.codex/plan/checklist.md)에 있다.
