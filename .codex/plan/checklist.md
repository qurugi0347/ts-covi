---
name: ts-covi-checklist
description: ts-covi 단계별 구현과 검증 완료 여부를 추적하는 체크리스트
created: 2026-09-20
---

# 개발 체크리스트

설계와 완료 조건은 [plan.md](plan.md), 근거는 [context.md](context.md)를 따른다. 체크는 실제 구현과 검증이 끝난 항목에만 한다.

## M0 저장소와 계획

- [x] 대상 경로·상위 지침·기존 저장소 여부 확인
- [x] main 브랜치로 로컬 Git 저장소 초기화
- [x] README와 기본 .gitignore 작성
- [x] 최종 목표·구현 방법·단계별 완료 기준 작성
- [x] GitNexus/Wecovi 확인 사실과 제안을 분리
- [x] 문서 frontmatter·상대 링크·Git whitespace 검사
- [x] 독립 계획 리뷰 및 필요한 수정 반영

## 구현 시작 조건

- [x] 사용자 계획 확인 및 M1 구현 요청 수신

## M1 기반과 JSON 계약 — M1.1~M1.3

- [x] Node/pnpm/TypeScript 호환 버전 고정 및 lockfile 생성
- [x] 단일 패키지 CLI/model/analyzer/ui 구조와 test/typecheck/build 명령 구성
- [x] version/source span/coverage/diagnostics/노드 계약과 공용 검증기 구현
- [x] 수동 sample JSON 및 유효/무효 계약 테스트
- [x] standalone HTML 파일 선택 후 블록 1개 렌더링
- [x] file:// 로딩, 버전/참조 오류 처리 확인

## M2 순차 분석 수직 흐름 — M2.1~M2.3

- [x] tsconfig/ignore 및 소스/해석 전용 파일 구분
- [x] project references 미지원 진단 및 범위 밖 경로 처리
- [x] 함수 인덱스와 충돌 없는 snapshot ID
- [x] 호출·중첩 호출·변수 초기화·일반 대입/증감·return·await 추출
- [x] 직접 호출/import alias 해석 및 외부/미해결 경계
- [x] CLI 인자, exit code, 원자적 JSON 저장
- [x] 실제 fixture → JSON → HTML 흐름과 저장 실패 보존 테스트

## M3 함수 내부 제어 구조 — M3.1~M3.2

- [x] if/삼항식/단락/optional chaining의 조건부 실행 보존
- [x] 반복 초기화·조건·본문·갱신 및 break/continue/label 대상 처리
- [x] throw/try/catch/finally 및 조기 종료 경로 처리
- [x] 콜백/미지원 구문에 명시적 경계와 진단, 순환 호출 참조에서도 유한 JSON 유지
- [x] 분기·반복·finally 종료 덮어쓰기 기대 결과 검증

## M4 주석과 인자 — M4.1

- [x] 함수 @covi/@covi-root/@covi-group 읽기
- [x] call-site @covi-call 파싱과 정확한 대상 결합
- [x] 원문 args와 annotation 분리, label 우선순위 구현
- [x] 모호/고아/잘못된 JSON/중복 표현식/spread 진단
- [x] 주석 전후 코드 구조 불변 및 JSON의 인자 설명 결합 결과 검증

## M5 탐색 UI — M5.1~M5.2

- [x] 함수 검색/선택과 조건·반복·예외 중첩 블록
- [x] 내부 함수 참조 펼치기 및 재귀 경계
- [x] 인자·주석·원문 패널과 소스 위치 표시, M4의 인자 설명 화면 검증
- [x] 오류/partial/크기 제한/텍스트 안전 렌더링
- [x] 키보드·포커스·aria·좁은 화면 점검
- [x] standalone HTML 및 JSON 기반 전체 탐색 E2E

## M6 실제 프로젝트와 첫 버전 완료 — M6.1~M6.2

- [ ] Wecovi 주문 흐름을 참고한 독립 fixture 검증
- [ ] 실제 TS/NestJS 프로젝트의 주요 함수와 결과 수동 대조
- [ ] 고정 환경 cold 3회 분석/로딩 시간, peak RSS, JSON 크기 기록
- [ ] 실제 결과에 따른 지원 구문·미지원 경계·사용법 문서 작성
- [ ] clean install → test → typecheck → build → CLI → file:// 뷰어 검증
- [ ] plan의 최종 완료 조건 확인 및 남은 위험 보고

## 요청 발생 후 검토할 확장

SQLite, 다중 언어, 증분/감시 모드, 런타임 추적, AI 설명, 소스 편집과 IDE 통합은 첫 버전 완료 조건이 아니다.


## 인수 및 원본 작업 완료

- [ ] 단계별 필수 검증 결과와 미실행 항목 기록
- [ ] 전체 흐름 사용자 확인 및 피드백 반영
- [ ] 원본 작업 완료: 최종 목표 충족, 예상 밖 파일 변경 없음 확인
- [ ] commit/PR 준비: 변경 범위·검증 결과·미해결 사항 정리 (실제 commit/PR은 별도 요청 시)

## 후속 TestCode PR — 보류

단계별 필수 fixture/assertion 검증은 위 항목에 유지한다. 아래는 이를 대체하지 않는 추가 회귀 확장이다.

- [ ] 후속 TestCode PR: tests/regression/의 분석·UI 회귀 시나리오 확장
  - 목적: M6에서 확인된 실제 사례의 재발 방지
  - 진행 조건: 원본 작업 완료, 원본 작업 commit/PR 준비 완료, 사용자 TestCode 작업 요청
  - PR 기준: 원본 작업 브랜치를 base로 별도 브랜치/별도 PR 생성
  - 상세 계획: [test-code-plan.md](test-code-plan.md) 참조
