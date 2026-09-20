---
name: ts-covi-followup-tests
description: 필수 단계 검증 이후 사용자 요청으로 수행할 실제 사례 기반 회귀 테스트 확장
created: 2026-09-20
status: deferred
---

# TestCode Plan

- 진행 조건: 원본 작업 완료 후 사용자 요청 시 진행
- PR 기준: 원본 작업 브랜치를 base로 별도 TestCode 브랜치/PR 생성
- 경계: M1~M6의 필수 테스트와 assertion은 원본 작업에 포함한다. 이 문서는 추가 회귀 사례만 다룬다. 구현 후 실제 구조에 맞춰 파일 경로를 확정한다.

## tests/regression/analyzer — 실제 소스에서 발견한 조합

- 목적: M6에서 발견한 회귀를 최소 fixture로 재현한다. 재현 사례 없이 대규모 조합을 생성하지 않는다.
- 의존성: 원본 작업 완료, 원본 작업 commit/PR 준비 완료, 사용자 TestCode 작업 요청

### 추가

- Given: 실제 프로젝트에서 확인한 구문·호출 경계와 기대 JSON을 가진 최소 소스
- When: 고정 버전 CLI로 분석한다.
- Then: 호출 해석, 분기·종료 경로, source span, coverage와 diagnostics가 기대값과 일치한다.

## tests/regression/viewer — 실제 탐색 흐름

- 목적: 실제 사용 중 발견한 탐색·입력 실패를 재현한다. 기존 필수 E2E를 중복하지 않는다.
- 의존성: 원본 작업 완료, 원본 작업 commit/PR 준비 완료, 사용자 TestCode 작업 요청

### 추가

- Given: M6에서 문제를 재현한 `.covi/flow.json`과 `.covi/index.html`
- When: 내장 결과 자동 로딩, JSON 교체, 함수 탐색, 호출 펼침과 키보드 조작을 재현한다.
- Then: 예상 블록·오류·재귀 경계·포커스를 확인하고 주석/원문이 텍스트로 표시된다.
