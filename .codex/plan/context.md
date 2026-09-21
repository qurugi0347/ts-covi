---
name: ts-covi-entrypoints-context
description: 진입점 탐색 요구와 코드 근거
created: 2026-09-21
status: implemented
---

# 작업 맥락

## 요청 원문

> 함수 검색이 보이는 위치에 함수들의 진입점 단위로 노출되면 좋을 것 같아 nestjs나 express같은 api라면 endpoint 단위 react나 vue 라면 페이지 단위로 볼 수 있게 하고싶은데 어떤 방법이 있을까?

> 저걸 구현할 계획 작성해줘 [$TaskPlan] [@Ponytail]

- 목적: 사용자가 기능의 시작점에서 함수 흐름을 읽게 한다.
- 문제: 전체 함수 평면 목록에 inline callback이 함께 노출돼 시작점 탐색이 어렵다.
- 방법: 라우트 선언에서 entrypoints를 추출하고 기존 functions를 ID로 연결한다. 수동 roots와 전체 함수 모드는 보존한다.

## 확인 사실

2026-09-21 기준 main / HEAD 2743e1a, origin/main과 일치하며 작업 시작 시 clean. 추가 저장소/상위 AGENTS.md는 발견되지 않았고 대화 제공 지침을 적용한다. M1~M6는 완료 상태다. 기존 전체 계획 5종을 completed-v1/에 복사하여 보존하고 새 확장 계획을 작성한다. HANDOFF의 과거 브랜치 표기는 현재 Git 상태의 근거로 사용하지 않는다.

| 확인 파일 | 사실 / 설계 근거 |
|---|---|
| src/model/flow.ts | formatVersion 1, roots 함수 ID 참조, groupPath, 공용 validateFlowDocument가 새 객체를 반환하므로 entrypoints 보존 로직 필요 |
| src/analyzer/analyze.ts | Program/Checker/함수 ID map, source span, @covi-root/group; JSX opaque 및 callback 시점 미추정 |
| src/ui/main.tsx | 모든 함수 평면 검색, roots 최초 선택, targetFunctionId 펼침; selectedEntryPointId 추가 필요 |
| src/cli/index.ts, viewer.ts | JSON 검증 후 HTML 동시 저장, partial exit 2, JSON 안전 embed 재사용 |
| package.json, tsconfig.json | Node >=22.16, TS Compiler API 6.0.3, React, esbuild/tsx; test/typecheck/build 존재 |
| README.md, HANDOFF.md, 기존 plan 3종 | 제품 정확성 원칙·지원 경계·과거 검증 결과 활용 |

이전 턴 AST 대조 결과 자체 스냅샷 227개 함수 중 anonymous 163개였으며 inline callback이 주원인이다. 이번 목적은 목록의 탐색 단위 개선이고 anonymous 함수 데이터 삭제는 아니다. 과거 17 tests 통과는 기존 이력이며 신규 기능 검증 결과가 아니다.

## 선택과 가정

NestJS/Express/API, React Router 페이지, Vue Router 페이지/원문까지 이번 계획에 포함. 사용자가 라우터를 지정하지 않아 React Router를 첫 구현 대상으로 제안한다. Next/TanStack/Nuxt 지원은 승인 시 범위 변경 가능하지만 자동 포함하지 않는다. Vue SFC 내부 분석은 별도 작업이다. 프레임워크 런타임을 부팅하지 않는다. 정적 목록은 실제 서버의 모든 배포 endpoint를 보장하지 않는다.

소스코드·구형 JSON 계약·CLI 저장과 partial 규칙을 유지한다. index.html은 함께 생성된 flow.json과 동일한 내장 스냅샷을 자동 표시하고 별도 파일 선택·드롭은 제공하지 않는다. .vue 참조 파일을 추가 수집할 경우 기존 프로젝트 루트/ignore/realpath 경계를 적용한다. DB·API 서버·새 plugin framework·배포 설정은 필요 없다. 첫 단계에서 신규 runtime dependency는 계획하지 않는다.

## 참고 근거

- [NestJS Controllers](https://docs.nestjs.com/controllers): Controller prefix와 method decorator.
- [Express middleware](https://expressjs.com/en/guide/using-middleware/): Router 및 middleware 등록.
- [React Router route object](https://reactrouter.com/start/data/route-object): Component/loader/action/lazy.
- [Vue Router lazy routes](https://router.vuejs.org/guide/advanced/lazy-loading): route component import.

공식 문서는 앞선 설계 조사에서 확인했다. 구체 지원 버전은 E3~E6 구현 검증 프로젝트에서 실제 package/lockfile과 함께 기록한다. 위 설명을 모든 버전 호환 보장으로 사용하지 않는다.

참조 작업 ‘ponytail 전역 설치’(019fe49c-b85d-7b92-b69e-b1cee92d0360)는 read_thread로 확인했다. 설치 이력일 뿐 제품 요구사항 근거가 아니다. 현재 제공된 Ponytail 4.10.0 지침을 적용한다.

## 검증 규칙

원본 구현에서 기존 검사와 임시 CLI/JSON assertion을 실행했다. 새/변경 TestCode 파일은 TaskPlan 지침에 따라 별도 후속 PR이며 사용자 요청 후 진행한다. 상세는 test-code-plan.md.

## 스크립트 지원 추가 요청

> 일반 script 같은거로 실행하는 case도 탐색할 수 있을까?
> 이 내용 plan 업데이트 해줘

목적은 프레임워크 없는 실행 파일도 진입점에서 탐색하는 것이다. analyze.ts의 supportedFunction 인덱스와 analyzeBody 호출을 재확인했고, 현재 파일 최상위 호출/await/조건문은 실행 단위로 수집되지 않는다. package.json에 tsx 명령과 dist JS bin이 있는 것도 확인했다. 따라서 현재 저장소의 bin을 원본 TS로 자동 연결한다고 보장하지 않는다.

선택: 공통 UI 뒤 S1을 추가한다. scripts/bin/명시 --entry로 실행 파일을 찾고, modules 선택적 필드와 별도 moduleCoverage로 함수와 구분한다. 최상위 블록 분석과 함수 호출 펼치기는 기존 로직을 재사용한다. 복잡한 shell과 JS sourcemap은 후속 범위이며 실행 파일 지정으로 보완한다. 제품 코드는 수정하지 않고 draft 계획 5종만 동기화한다.

## 스크립트 범위 철회

2026-09-21 사용자 피드백에 따라 신규 분석에서는 package script, bin, `--entry`를 진입점으로 만들지 않는다. analyzer와 CLI의 탐지 경로는 제거하고, 이미 생성된 JSON을 계속 열 수 있도록 model validator와 UI의 script/module 읽기 호환만 유지한다.
