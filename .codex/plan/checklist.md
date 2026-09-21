---
name: ts-covi-entrypoints-checklist
description: 진입점 탐색 단계별 실행 체크리스트
created: 2026-09-21
status: complete
---

# 진입점 탐색 체크리스트

기존 완료 기록: [M1~M6](completed-v1/checklist.md). 아래는 신규 작업이며 구현 완료로 체크하지 않는다.

## 계획

- [x] 현재 코드·Git·기존 문서·Ponytail 참조 작업 확인
- [x] 범위·계약·의존성·검증 계획 작성
- [x] 사용자 계획 확인 및 구현 요청

## Phase 1 — 계약과 UI

- [x] E1 entrypoints v1 optional 확장·검증·수동 roots 매핑
- [x] E1 검증: 구형 JSON·깨진 참조·복수 target assertion
- [x] E2 진입점/전체 함수 모드·그룹·검색·선택 분리
- [x] E2 검증: 0건·복수 URL·JSON 교체·source-only·키보드/320px

## Phase 2 — 스크립트 (S1)

- [x] S1 package scripts/bin/--entry 입력 탐지와 경로 경계·include 밖 Program 입력
- [x] S1 modules 계약·validator·moduleCoverage·최상위 분석·UI 선택
- [x] S1 검증: 초기화→await→main, IIFE, 함수 본문 중복 없음, 별칭 module 공유
- [x] S1 검증: 복잡한 shell/bin JS partial, 명시 파일 오류 exit 1, 외부/ignore 경로, 구형 JSON
- [x] S1 검증: script 선택→함수 펼침→JSON 교체 및 source 없는 미해결 표시

## Phase 3 — API

- [x] E3 NestJS decorator/import 탐지
- [x] E3 검증: 경로 배열·alias·global prefix 미확정·동명 API 오탐
- [x] E4 Express mount·등록 handler 탐지
- [x] E4 검증: 복수/순환 mount·미들웨어·동적 경로 partial

## Phase 4 — 페이지

- [x] E5 React Router 객체/JSX·nested/index/pathless·대상 연결
- [x] E5 검증: Component/element·loader/action·lazy 미해결
- [x] E6 Vue Router 및 .vue 원문 위치 연결
- [x] E6 검증: nested·import·원문 위치·ignore/외부 경로·SFC partial

## Phase 5 — 통합과 인수

- [x] E7 pnpm test / pnpm typecheck / pnpm build 기존 검사 실행
- [x] E7 compiled CLI → JSON → standalone HTML 원문 대조
- [x] E7 구형 JSON 교체·악성 label 텍스트 처리·partial exit 2 유지
- [x] E7 분석/로딩/메모리/출력 크기 전후 비교 및 미실행 검증 기록
- [x] E7 README/HANDOFF 지원 경계 갱신
- [x] E8 사용자 결과 확인 및 피드백 반영
- [x] E8 원본 작업 완료와 commit/PR 준비; 실제 Git 작업은 승인 범위에서만

## 후속 TestCode PR — 보류

- [ ] 후속 TestCode PR: model/analyzer/UI 진입점 회귀 테스트
  - 목적: route 탐지·JSON 호환·선택 상태의 회귀 방지
  - 진행 조건: 원본 작업 완료, 원본 작업 commit/PR 준비 완료, 사용자 TestCode 작업 요청
  - PR 기준: 원본 작업 브랜치를 base로 별도 브랜치/별도 PR 생성
  - 상세 계획: [test-code-plan.md](test-code-plan.md) 참조
