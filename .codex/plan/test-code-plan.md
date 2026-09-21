---
name: ts-covi-entrypoints-tests
description: 원본 작업 이후 요청 시 수행할 회귀 테스트 계획
created: 2026-09-21
status: deferred
---

# TestCode Plan

- 진행 조건: 원본 작업 완료 후 사용자 요청 시 진행
- PR 기준: 원본 작업 브랜치를 base로 별도 TestCode 브랜치/PR 생성
- 의존성: E1~E8 및 S1 원본 구현·필수 검증·commit/PR 준비 완료와 사용자 TestCode 요청
- 범위: 테스트 파일의 작성/수정만 후속. 기존 검사와 임시 입력 assertion은 원본 구현 검증에서 생략하지 않는다.

## src/model/flow.test.ts — 계약 보존

### 기존
- Given: entrypoints가 없는 v1 JSON
- When: 공용 validator 실행
- Then: 기존 functions/roots가 유효

### 변경 후
- Given: 구형 v1 및 entrypoints 포함 v1
- When: validation 후 serialize/parse
- Then: 구형 입력 허용, 새 targets/source가 보존되고 잘못된 enum/ID/span은 거절

## src/analyzer/entrypoints.test.ts — 추가 예정

### 추가: API
- Given: 실제 선택 버전의 Nest/Express import, 동일 함수 복수 URL, 다중 handler, 복수 mount
- When: analyzeProject
- Then: 올바른 경로/target ID와 순서, distinct entry ID; 순환·동적 값은 유한 partial, 동명 사용자 API는 제외

### 추가: 페이지
- Given: React Router nested/index/pathless/element/Component, Vue Router .vue import
- When: analyzeProject
- Then: 페이지 경로·타겟/원문이 연결되고 event/effect를 동기 호출로 합치지 않음; .vue 내부는 partial

### 추가: 경계
- Given: 외부 symlink, ignored .vue, 깨진 import, 순환 const, 알 수 없는 global prefix
- When: 탐지/수집
- Then: 경계 밖 소스 노출 없음, 미해결 사유·원문 위치 유지, 무한 재귀 없음

## UI/CLI 회귀 — 구현 후 실제 파일 위치 확정

### 기존
- Given: 함수 목록이 있는 v1 스냅샷
- When: 검색·선택·JSON 교체
- Then: 함수 블록을 탐색

### 변경 후
- Given: 진입점 포함/미포함 JSON, 같은 함수를 가리키는 두 URL, source-only 대상
- When: 모드 전환·검색·entry 선택·target 선택·JSON 교체
- Then: 진입점 ID 선택 유지, source-only에서 이전 블록 제거, 빈 상태 구분, 파일 교체 시 상태 초기화

### 추가: standalone
- Given: 악성 label/경로 문자열 및 partial 결과
- When: CLI HTML 생성 후 파일 열기
- Then: 텍스트로 안전하게 표시, 로컬 네트워크 요청 없이 내장 결과 표시, JSON/HTML 동일 스냅샷

## 스크립트 진입점 — 제외

사용자 피드백으로 신규 script 진입점 생성이 제거되어 아래 회귀 테스트 계획은 진행하지 않는다. 기존 script/module JSON 읽기 호환은 model/UI 호환 테스트 범위에서만 유지한다.
