# AGENTS.md - 프로젝트 에이전트 작업 지침

이 저장소는 Google Docs 기획안과 Google Sheets 기반 데이터를 Neo4j 지식그래프에 적재하고, 이를 탐색하여 답변하는 **Next.js 기반 GraphRAG 챗봇** 프로젝트입니다. Antigravity를 비롯한 AI 코딩 에이전트는 아래 지침을 반드시 준수해 작업해 주세요.

## 1. 핵심 프로젝트 구조 및 역할
* **프론트엔드 / API 서버:** 루트 디렉토리의 Next.js(App Router) 애플리케이션
* **지식그래프 DB:** Neo4j (스키마 조회 및 Cypher 쿼리 실행 대상)
* **기획 및 데이터 참고 자료:** 프로젝트 폴더 uploads 내 배치된 기획안 문서(`.md`) 및 데이터 파일(`.csv`, `.cypher`)
* **에이전트 주요 임무:**
  1. 현재 Neo4j 그래프 스키마와 기획안을 분석하여 추가 탐색 가능한 그래프 질의 시나리오 도출
  2. 자연어 질문을 Cypher 쿼리로 변환(Text-to-Cypher)하고 검색 결과를 바탕으로 답변하는 RAG 챗봇 구현

## 2. 개발 서버 운영 규칙 (`npm run build` 금지)
* **반드시 개발 서버(`npm run dev`)만 사용하세요.** 코드 수정 시 HMR(Hot Module Replacement)을 통해 실시간으로 변경 사항을 확인합니다.
* **에이전트 세션 중에는 절대 `npm run build`를 실행하지 마세요.** 프로덕션 빌드를 실행하면 `.next` 폴더가 배포용 자산으로 덮어씌워져 핫 리로드가 깨지고 개발 서버 상태가 꼬입니다. 프로덕션 빌드는 배포 직전에만 별도로 수행합니다.

## 3. Neo4j 및 데이터 처리 안전 수칙 (중요)
* **읽기 전용 쿼리 우선 원칙:** 챗봇의 Text-to-Cypher 생성 로직이나 MCP 탐색 시에는 기본적으로 `MATCH`, `RETURN`, `CALL db.schema.*` 등 **데이터를 조회하는 읽기 전용 쿼리**만 생성·실행하세요.
* **데이터 변경 차단:** 사용자의 명시적 승인 없이는 기존 Neo4j 그래프 데이터를 삭제하거나 덮어쓰는 `DELETE`, `DETACH DELETE`, `DROP` 쿼리를 절대 실행하지 마세요.
* **근거 기반 답변(Hallucination 방지):** RAG 챗봇 답변 생성 시 Neo4j 조회 결과에 없는 내용은 추측하여 지어내지 말고, 조회된 노드·관계 근거와 함께 답변하도록 프롬프트 및 파이프라인을 설계하세요.

## 4. 환경 변수 및 보안 관리
* Neo4j 접속 정보(`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`)와 LLM 키(`GEMINI_API_KEY`)는 반드시 `.env.local` 파일로 관리합니다.
* `.env.local` 파일은 `.gitignore`에 포함하여 절대 GitHub 원격 저장소에 커밋·푸시하지 마세요.
* 새로운 환경 변수가 필요할 경우 `.env.example` 파일에 키 이름만 기록해 두고 사용자에게 값 입력을 요청하세요.

## 5. 의존성 및 코딩 컨벤션
* 새로운 패키지(`neo4j-driver`, `@google/genai` 등)를 설치하거나 수정할 때는 `package-lock.json`을 함께 동기화하고, 필요시 개발 서버를 재시작하세요.
* 모든 신규 컴포넌트, API 라우트, 유틸리티는 **TypeScript(`.tsx` / `.ts`)**로 작성합니다.
* UI 텍스트, 주석, 사용자 안내 메시지는 **한국어**를 기본으로 작성합니다.

## 6. 주요 명령어 요약

| 명령어 | 용도 |
| :--- | :--- |
| `npm run dev` | HMR이 활성화된 Next.js 개발 서버 실행 (기본 사용) |
| `npm run lint` | ESLint 코드 문법 및 규칙 검사 |
| `npm run test` | 테스트 스위트 실행 (구성된 경우) |
| `npm run build` | **프로덕션 빌드 — 에이전트 작업 중 실행 금지** |
