# Obsidian Second Brain Agent (OSBA) 개발 명세서 (SPEC)

## 1. 개요 (Executive Summary)
본 프로젝트는 Obsidian을 단순한 노트 앱에서 지능형 "제2의 뇌(Second Brain)" 자동화 시스템으로 진화시키는 플러그인 개발을 목표로 합니다.
비용 효율성을 위해 Gemini(저비용/고속)와 Grok/Claude(대용량 문맥 처리)를 혼합한 **하이브리드 AI 모델**을 사용하며, 사용자의 지식 베이스를 자율적으로 관리, 연결 및 확장합니다.

**핵심 정의:** 이 플러그인은 Obsidian UI 내에서 **컨트롤러(Controller)** 역할을 수행하며, 무거운 인지 작업은 강력한 **백그라운드 터미널 프로세스(CLI Agent)** 에 위임합니다. 이를 통해 복잡한 분석 작업이 진행되는 동안에도 Obsidian 인터페이스의 쾌적함을 유지합니다.

## 2. 시스템 아키텍처 (System Architecture)

이 시스템은 로컬 쉘 실행을 통해 통신하는 두 가지 독립적인 부분으로 구성됩니다.

### A. 프론트엔드 (Obsidian Plugin)
*   **역할**: 사용자 인터페이스(UI), 명령 트리거, 작업 대기열 시각화.
*   **구현 언어**: TypeScript.
*   **주요 책임**:
    *   사용자 의도 파악 (예: "X에 대한 노트 작성해줘", "이 노트와 관련된 연결 고리 찾아줘").
    *   **터미널 명령 실행 (Spawn Terminal Commands)**: `child_process`를 사용하여 백그라운드 스크립트/CLI를 실행합니다.
    *   **파일 감시 (File Watching)**: CLI 에이전트가 수행한 변경 사항을 감지하고 UI를 새로고침합니다.
    *   **상태 대시보드**: "에이전트 큐" 상태를 표시합니다 (예: "3개 작업 실행 중, 5개 대기 중").

### B. 백엔드 (Terminal / CLI Engine)
*   **역할**: 실제 "두뇌" 역할을 하는 실행 엔진입니다. (사용자의 "터미널 구동" 요구사항 충족)
*   **구현 언어**: Python (강력한 라이브러리 생태계로 인해 권장) 또는 Node.js.
*   **주요 책임**:
    1.  **문맥 로딩 (Context Loading)**: Vault 내의 파일들을 읽어들입니다 (Grok 등을 위한 200만 토큰 처리).
    2.  **API 오케스트레이션 (Orchestration)**:
        *   **Fast Lane (Gemini)**: 단순 생성, 초안 작성, 포맷팅용.
        *   **Deep Lane (Grok/Claude)**: 전체 Vault 스캔, 백링크 분석, 갭(Gap) 분석용.
    3.  **파일 조작**: `.md` 파일을 직접 수정합니다 (YAML 주입, 링크 추가, 아이디어 덧붙이기).

---

## 3. 핵심 기능 및 워크플로우 (Core Features & Workflow)

### 기능 1: "Lite" Writer (Gemini Agent)
*   **트리거**: 커맨드 팔레트 `OSBA: Quick Draft` 또는 `OSBA: Polish Note`.
*   **프로세스**:
    1.  사용자가 프롬프트를 입력합니다.
    2.  플러그인 실행: `python agent.py --task draft --model gemini --prompt "..."`
    3.  CLI가 콘텐츠를 가져와 마크다운을 생성하고 파일을 만듭니다.
    4.  플러그인이 "초안 작성 완료" 알림을 보냅니다.

### 기능 2: "Deep" Archivist (Grok/Claude Agent)
*   **트리거**: 새 파일 생성 시 자동 실행 또는 수동 트리거 `OSBA: Scan Vault Connections`.
*   **프로세스**:
    1.  플러그인 실행: `python agent.py --task analyze --file "NewNote.md" --context "full_vault"`
    2.  **백그라운드 작업**:
        *   CLI가 Vault 내의 모든(또는 타겟) `.md` 파일을 읽습니다 (2M 컨텍스트 시뮬레이션).
        *   대용량 컨텍스트를 Grok API 등으로 전송합니다.
        *   프롬프트: "이 새로운 노트를 기존 500개의 노트 맥락 안에서 분석해. 백링크를 제안하고 부족한 내용(Gap)을 찾아줘."
    3.  **결과 적용**:
        *   CLI가 노트 하단에 `## 🧠 Connected Insights` 섹션을 추가합니다.
        *   CLI가 YAML frontmatter의 `related: [...]` 항목을 업데이트합니다.

### 기능 3: 비동기 작업 대기열 (Asynchronous Job Queue)
*   **컨셉**: 터미널의 "Task Manager"와 유사합니다.
*   **UI**: 사이드바 뷰를 통해 다음을 표시합니다:
    *   🟢 Job #101: 전체 Vault 스캔 중... (실행 중)
    *   🟡 Job #102: Gemini 초안 작성 (대기 중)
*   **매커니즘**: CLI가 `.obsidian` 폴더 내의 작은 `status.json` 파일을 업데이트하면, 플러그인이 이를 감지하여 진행률 표시줄을 업데이트합니다.

---

## 4. 기술 명세 (Technical Specifications)

### 기술 스택 (Tech Stack)
*   **플러그인 프레임워크**: Obsidian API 표준.
*   **CLI 엔진**:
    *   언어: Python 3.10+ (`langchain` 또는 `requests`를 사용한 API 제어 용이).
    *   라이브러리: `watchdog` (파일 모니터링), `openai` / `google-generativeai` SDK.
*   **통신 방식**: 표준 I/O (플러그인이 프로세스를 Spawn하고 `stdout`으로 로그를 읽음).

### 컨텍스트 전략 ("2M Token" 로직)
*   **직접 주입 (Direct Feed)**: Grok과 같은 대용량 모델의 경우 Vault의 원문 텍스트를 직접 피딩할 수 있습니다.
*   **최적화**: 매번 10,000개의 파일을 다시 읽는 것을 방지하기 위해:
    1.  CLI는 Vault의 "요약(Summary)" 캐시 파일을 유지합니다 (경량 벡터 인덱스 또는 연결된 요약본).
    2.  "Deep Analysis"가 명시적으로 요청될 때만 전체 컨텍스트를 로드합니다.

---

## 5. 제약 사항 및 해결 방안
*   **제약**: Python 스크립트를 실행하려면 사용자의 컴퓨터에 Python이 설치되어 있어야 합니다.
    *   *해결*: 플러그인 설정에 `Python 실행 파일 경로` 입력 필드를 제공합니다.
*   **제약**: 대규모 스캔에 따른 API 비용 문제.
    *   *해결*: "예산 모드(Budget Mode)"를 구현하여, 사용자가 명시적으로 승인한 경우나 특정 폴더에 대해서만 Deep Agent가 작동하도록 제한합니다.

---

### 🚀 프로토타입 로드맵 (Roadmap)
1.  **Step 1 (The CLI)**: 파일 경로를 받아 Gemini API를 호출하고 요약을 덧붙이는 간단한 Python 스크립트 `agent.py`를 작성합니다. (터미널에서 테스트)
2.  **Step 2 (The Plugin Bridge)**: `python agent.py`를 실행 버튼 하나로 호출할 수 있는 기본 Obsidian 플러그인을 생성합니다.
3.  **Step 3 (Integration)**: Obsidian의 현재 활성 파일 경로를 Python 스크립트로 전달하는 기능을 구현합니다.
4.  **Step 4 (Deep Logic)**: Python 스크립트에 Grok 2M 컨텍스트 로직을 구현하여 대규모 분석을 수행합니다.
