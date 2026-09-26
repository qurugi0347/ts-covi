# 프로젝트: ts-covi

## 현재 상태

M1~M6와 진입점 중심 탐색 구현이 `feature/entrypoint-navigation`에 완료됐다. TypeScript Compiler API 6.0.3 기반 CLI가 TS/TSX를 `.covi/flow.json`과 자동 로딩되는 `.covi/index.html`로 저장한다. HTML에서 API·페이지·수동 진입점 또는 전체 함수를 선택하고, 중첩 블록·내부 호출 펼침·재귀 경계·인자·주석·원문을 탐색한다.

package script와 bin은 진입점으로 만들지 않는다. 프레임워크 진입점은 NestJS decorator, Express app/Router, React Router route object/JSX, Vue Router route를 import 출처가 확인된 경우에 탐지한다. Vue SFC는 저장소 내부 원문까지만 연결한다. 과거 script entrypoint JSON을 여는 호환 타입과 UI는 유지한다.

다른 로컬 저장소에서 사용하려면 이 저장소에서 `pnpm install:global`을 실행한다. pnpm 전역 wrapper의 symlink 경로를 realpath로 판별하므로 `ts-covi analyze --project ./tsconfig.json`이 대상 저장소에서 직접 동작한다.

## 검증

- `pnpm test`: 17개 통과
- `pnpm typecheck`: 통과
- `pnpm build`: standalone viewer 생성
- clean archive 설치부터 주문 CLI 분석까지 통과
- 주문 fixture: complete JSON과 file:// 탐색 통과
- 자체 프로젝트 분석: partial JSON 생성 및 주요 함수 원문 대조 통과
- 임시 통합 프로젝트: NestJS 4, Express 2, React Router 4, Vue Router 1개 진입점과 `.vue` 원문 연결 확인
- compiled CLI: partial exit 2, JSON/내장 HTML 생성, entrypoint·source span 대조 통과
- 320px viewport, 키보드 focus, aria, 악성 HTML 문자열, invalid version 확인

성능과 상세 환경은 README에 기록했다. 추가 회귀 테스트 확장은 별도 후속 작업으로 보류돼 있다.

## 핵심 경계

실제 실행 값·분기·반복 횟수·비동기 완료 순서는 추측하지 않는다. NestJS global prefix, 동적 mount/route, Vue SFC 함수 흐름, project references, generator 의미, callback 실행 시점, 런타임 DI와 동적 구현은 partial 진단 또는 명시적 경계로 남긴다. DB·AI·IDE 통합은 후속 범위다.
