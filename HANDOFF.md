# 프로젝트: ts-covi

## 현재 상태

M1~M6 구현이 `codex/implement-ts-covi`에 완료됐다. TypeScript Compiler API 6.0.3 기반 CLI가 TS/TSX를 JSON으로 저장하고, `dist/viewer.html`에서 함수 검색·중첩 블록·내부 호출 펼침·재귀 경계·인자·주석·원문을 탐색한다.

## 검증

- `pnpm test`: 14개 통과
- `pnpm typecheck`: 통과
- `pnpm build`: standalone viewer 생성
- clean archive 설치부터 주문 CLI 분석까지 통과
- 주문 fixture: complete JSON과 file:// 탐색 통과
- 자체 프로젝트 분석: partial JSON 생성 및 주요 함수 원문 대조 통과
- 320px viewport, 키보드 focus, aria, 악성 HTML 문자열, invalid version 확인

성능과 상세 환경은 README에 기록했다. 추가 회귀 테스트 확장은 `.codex/plan/test-code-plan.md`에 보류돼 있다.

## 핵심 경계

실제 실행 값·분기·반복 횟수·비동기 완료 순서는 추측하지 않는다. project references, generator 의미, callback 실행 시점, 런타임 DI와 동적 구현은 partial 진단 또는 명시적 경계로 남긴다. DB·AI·IDE 통합은 후속 범위다.
