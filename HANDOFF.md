# 프로젝트: ts-covi

## 목표
`/Users/overdune/dev/covi/ts-covi`에서 TS/TSX를 정적 분석해 JSON으로 저장하고, standalone HTML에서 함수의 순서·분기·반복을 Scratch 형태로 읽는다. 호출별 주석·인자 표시와 내부 함수 펼치기를 지원한다.

## 완료된 작업
- main 저장소 초기화, README와 `.codex/plan/{plan,context,checklist}.md` 작성·문서 검증 완료.
- M0 완료. 계획은 draft이며 제품 코드·의존성·커밋·원격 연결은 없다.

## 실패한 시도와 현재 문제
실패나 blocker는 없다. 분석기 실행·빌드·성능 검증은 아직 하지 않았다.

## 다음 단계
1. Git 상태와 적용 지침, README, 계획 3종을 읽는다.
2. 구현을 이어갈 경우 M1의 버전·JSON 계약·최소 HTML부터 단계별 완료 기준으로 진행한다.
3. `/Users/overdune/dev/wecovi-plugin`은 읽기 전용 참고다. 기존 변경을 보존한다.

## 핵심 경계
Compiler API·JSON·React는 설계 제안이다. 실제 실행 값/순서를 추측하지 않고 미해결·미지원은 표시한다. 주석과 코드 인자를 분리하며 DB·AI·IDE 통합은 후속 범위다.
