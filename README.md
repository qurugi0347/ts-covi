# ts-covi

TypeScript 코드를 분석해 로컬 JSON으로 저장하고, HTML에서 함수 내부 흐름을 Scratch처럼 중첩 블록으로 읽는 도구.

현재는 **설계 단계**다. 분석기·CLI·뷰어와 실행 명령은 아직 구현되지 않았다.

- [구조 개요](.codex/plan/architecture.html): 변경 목적, 데이터 흐름, 작업 연결
- [개발 계획](.codex/plan/plan.md): 최종 목표, 구현 방법, 단계별 완료 기준
- [작업 맥락](.codex/plan/context.md): 사용자 요구와 참고 프로젝트의 확인된 사실
- [진행 체크리스트](.codex/plan/checklist.md): 구현 및 검증 상태

예정 흐름: `TypeScript 프로젝트 → 분석 CLI → flow.json → HTML 뷰어`

첫 지원 대상은 TS/TSX다. 정적으로 확인 가능한 흐름을 표시하며, 실제 실행 결과·인자 값·비동기 완료 시점을 추측하지 않는다.
