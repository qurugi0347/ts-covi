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

프로젝트의 `tsconfig.json`을 분석한다. 기본 출력은 `.covi/flow.json`이다.

```bash
pnpm analyze --project ./tsconfig.json --out ./.covi/flow.json
open ./dist/viewer.html
```

`viewer.html`을 `file://`로 연 뒤 JSON을 선택하거나 화면에 놓는다. 별도 서버와 원본 프로젝트가 없어도 함수 검색, 중첩 블록, 내부 함수 펼치기, 인자·주석·원문을 탐색할 수 있다.

배포된 CLI 형태의 인터페이스는 다음과 같다.

```bash
ts-covi analyze --project ./tsconfig.json --out ./.covi/flow.json
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

함수 정의는 `functions`에 한 번 저장하고 호출은 ID로 참조한다. 주석 설명과 코드의 인자 표현식은 별도 필드다. 알 수 없는 구문과 호출은 원문·위치·진단을 남기며, 실제 분기 결과·인자 값·반복 횟수·Promise 완료 순서를 추측하지 않는다.

현재 경계는 project references, generator/yield 의미, callback 실행 시점, 동적 속성 호출, 런타임 DI와 다중 구현체다. JSX는 opaque 표현식으로 남는다. SQLite, 증분 분석, 런타임 trace, AI 설명, IDE 통합은 포함하지 않는다.

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

계획과 검증 근거는 [구조 개요](.codex/plan/architecture.html), [개발 계획](.codex/plan/plan.md), [작업 맥락](.codex/plan/context.md), [체크리스트](.codex/plan/checklist.md)에 있다.
