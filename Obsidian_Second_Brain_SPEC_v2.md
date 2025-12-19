# Obsidian Second Brain Agent (OSBA) v2.0
## 실제 구현 가능한 개발 명세서

> **문서 버전**: 2.0 (2025-12-19)
> **원본 대비 주요 변경**: RAG 기반 아키텍처, Node.js 단일 스택, 현실적 비용 모델

---

## 1. Executive Summary

### 1.1 프로젝트 개요
Obsidian을 **지능형 "제2의 뇌(Second Brain)"** 로 진화시키는 플러그인입니다. AI가 노트 간 연결고리를 자동으로 발견하고, 지식 갭을 분석하며, 새로운 콘텐츠 생성을 지원합니다.

### 1.2 원본 SPEC 대비 핵심 변경사항

| 항목 | 원본 SPEC | v2.0 변경 |
|------|----------|----------|
| **아키텍처** | Python CLI + Obsidian Plugin 분리 | Node.js 단일 스택 (플러그인 내장) |
| **컨텍스트 전략** | Grok 200만 토큰 직접 전송 | **RAG 파이프라인** (관련 노트만 검색) |
| **통신 방식** | status.json 파일 감시 | **EventEmitter 패턴** (실시간) |
| **비용 관리** | "예산 모드" 언급만 | **상세한 비용 추적 + 자동 모델 선택** |
| **에러 처리** | 없음 | **3단계 복구 전략 + Fallback 모델** |

### 1.3 왜 이렇게 변경했는가?

**원본의 문제점 1: 200만 토큰 직접 전송의 비현실성**
- Grok API에 200만 토큰을 한 번에 보내면:
  - 비용: 약 $6-20/요청 (모델에 따라)
  - 응답 시간: 30초~3분
  - Rate Limit 위험
- **해결책**: 임베딩 기반 RAG로 관련 노트 30개만 검색 → 비용 99% 절감

**원본의 문제점 2: Python 의존성**
- 일반 사용자에게 Python 설치 요구 = 진입 장벽
- Obsidian 자체가 Electron/Node.js 기반
- **해결책**: 모든 로직을 TypeScript로 구현, Worker Thread로 성능 확보

**원본의 문제점 3: 파일 감시 방식의 비효율성**
- status.json polling은 지연 발생 + 리소스 낭비
- **해결책**: EventEmitter 패턴으로 즉각적인 UI 업데이트

---

## 2. 시스템 아키텍처

### 2.1 3-Tier 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TIER 1: Obsidian Plugin (UI Layer)               │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Command      │  │ Sidebar      │  │ Settings     │              │
│  │ Palette      │  │ Job Queue    │  │ Panel        │              │
│  │ Commands     │  │ View         │  │              │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                           │                                         │
│               EventEmitter (실시간 상태 업데이트)                    │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│              TIER 2: Local Intelligence Layer (Worker Thread)       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ SQLite +     │  │ Job Queue    │  │ RAG          │              │
│  │ sqlite-vec   │  │ Manager      │  │ Pipeline     │              │
│  │ (벡터 검색)  │  │              │  │              │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  ┌──────────────────────────────────────────────────┐              │
│  │ Embedding Cache │ Response Cache │ Summary Cache │              │
│  └──────────────────────────────────────────────────┘              │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼ HTTPS API Calls
┌─────────────────────────────────────────────────────────────────────┐
│                       TIER 3: AI API Layer                          │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Gemini Flash    │  │ Claude 3.5      │  │ OpenAI          │     │
│  │ (빠른 생성)     │  │ Sonnet (분석)   │  │ (임베딩 전용)   │     │
│  │                 │  │                 │  │                 │     │
│  │ $0.075/1M tok   │  │ $3/1M input     │  │ $0.02/1M tok    │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 컴포넌트 역할 정의

#### TIER 1: UI Layer
| 컴포넌트 | 책임 | 기술 |
|---------|------|------|
| Command Palette | 사용자 명령 트리거 | Obsidian API |
| Sidebar View | 작업 큐 시각화 | React/Svelte |
| Settings Panel | API 키, 모델, 예산 설정 | Obsidian Settings API |
| Modal Dialogs | 프롬프트 입력, 확인 | Obsidian Modal API |

#### TIER 2: Intelligence Layer
| 컴포넌트 | 책임 | 기술 |
|---------|------|------|
| SQLite + sqlite-vec | 메타데이터 + 벡터 저장 | better-sqlite3 + sqlite-vec |
| Job Queue Manager | 비동기 작업 스케줄링 | 커스텀 구현 |
| RAG Pipeline | 관련 노트 검색 + 컨텍스트 구성 | 커스텀 구현 |
| Cache Layer | 임베딩/응답/요약 캐싱 | LRU Cache |

#### TIER 3: API Layer
| 제공자 | 용도 | 모델 | 비용 |
|--------|------|------|------|
| Google | 빠른 콘텐츠 생성 | gemini-2.0-flash-exp | $0.075/1M 토큰 |
| Anthropic | 복잡한 분석 | claude-3-5-sonnet | $3/1M input |
| OpenAI | 임베딩 생성 | text-embedding-3-small | $0.02/1M 토큰 |

---

## 3. 핵심 기능 상세

### 3.1 기능 1: Quick Draft (빠른 초안 작성)

**명령어**: `OSBA: Quick Draft` 또는 단축키 `Cmd/Ctrl + Shift + D`

**워크플로우**:
```
┌──────────────────────────────────────────────────────────────────┐
│ 1. 사용자 프롬프트 입력                                          │
│    "AI 자동화 도구에 대한 노트 작성해줘"                          │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. [로컬] 현재 노트 컨텍스트 추출                                 │
│    - YAML frontmatter 파싱                                       │
│    - 현재 노트의 태그/링크 수집                                   │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. [로컬] 관련 노트 5개 검색 (SQLite 벡터 검색)                   │
│    - 프롬프트 임베딩 생성                                        │
│    - 유사도 Top 5 검색                                           │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. [API] Gemini Flash 호출                                       │
│    - 모델: gemini-2.0-flash-exp                                  │
│    - 입력: 프롬프트 + 관련 노트 요약 (~2,000 토큰)               │
│    - 출력: 마크다운 콘텐츠 (~1,500 토큰)                         │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. [로컬] 결과 처리                                              │
│    - 새 노트 생성 또는 현재 노트에 삽입                          │
│    - YAML frontmatter 자동 생성                                  │
│    - 사용자에게 완료 알림                                        │
└──────────────────────────────────────────────────────────────────┘
```

**예상 비용**: ~$0.0002/요청 (약 5,000회 = $1)

**프롬프트 템플릿**:
```markdown
당신은 Obsidian 지식 관리 전문가입니다.

## 사용자 요청
{user_prompt}

## 현재 노트 컨텍스트
제목: {current_note_title}
태그: {current_tags}

## 관련 노트 요약
{related_notes_summary}

## 지침
1. Obsidian 마크다운 형식으로 작성하세요
2. 관련 노트와 연결될 수 있는 [[wikilink]]를 포함하세요
3. 적절한 태그(#tag)를 제안하세요
4. 구조화된 헤더(##, ###)를 사용하세요

응답은 마크다운 본문만 작성하세요 (YAML frontmatter 제외).
```

---

### 3.2 기능 2: Connection Analyzer (연결 분석기)

**명령어**: `OSBA: Analyze Connections` 또는 새 노트 생성 시 자동 실행 (설정 가능)

**워크플로우**:
```
┌──────────────────────────────────────────────────────────────────┐
│ 1. [로컬] 대상 노트 처리                                         │
│    - 노트 내용 추출                                              │
│    - 임베딩 생성 (캐시 확인 후 필요시 API 호출)                  │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. [로컬] RAG 파이프라인 실행                                    │
│    - SQLite-vec로 유사 노트 Top 30 검색                          │
│    - 각 노트의 요약/제목/태그 추출                               │
│    - 컨텍스트 윈도우 구성 (~8,000 토큰)                          │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. [API] Claude 3.5 Sonnet 호출                                  │
│    - 입력: 대상 노트 + 관련 노트 30개 요약                       │
│    - 분석 요청: 연결 관계, Gap 분석, 백링크 추천                 │
│    - 응답: 구조화된 JSON                                         │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. [로컬] 결과 적용                                              │
│    - YAML frontmatter의 osba.related 업데이트                    │
│    - "## 🧠 Connected Insights" 섹션 추가/업데이트               │
│    - SQLite connections 테이블 업데이트                          │
└──────────────────────────────────────────────────────────────────┘
```

**예상 비용**: ~$0.03/요청 (약 33회 = $1)

**분석 프롬프트 템플릿**:
```markdown
당신은 지식 관리 및 연결 분석 전문가입니다.

## 분석 대상 노트
제목: {target_title}
내용:
{target_content}

## 관련 노트 목록 (유사도 순)
{related_notes_list}
// 각 노트: 제목, 요약, 태그, 유사도 점수

## 분석 요청
1. **연결 관계 분석**: 대상 노트와 각 관련 노트의 관계 유형 파악
   - extends: 주제를 확장/심화
   - supports: 주장을 뒷받침
   - contradicts: 상반된 관점 제시
   - examples: 구체적 사례 제공

2. **지식 갭 분석**: 대상 노트에서 다루지 않았지만 다뤄야 할 주제
   - 우선순위: high/medium/low

3. **백링크 추천**: 대상 노트에서 링크해야 할 기존 노트

## 응답 형식 (JSON)
{
  "relations": [
    { "note": "노트 경로", "type": "extends", "reason": "이유", "score": 0.85 }
  ],
  "gaps": [
    { "topic": "주제", "priority": "high", "reason": "이유" }
  ],
  "backlinks": [
    { "note": "노트 경로", "anchor_text": "링크 텍스트", "reason": "이유" }
  ]
}
```

**결과 적용 예시**:

```yaml
---
# OSBA 자동 관리 필드
osba:
  version: 1
  last_analyzed: 2025-12-19T10:30:00Z
  embedding_id: "emb_abc123"
  confidence_score: 0.85
  related:
    - path: "Notes/AI-Tools.md"
      score: 0.92
      relation: "extends"
    - path: "Notes/Productivity.md"
      score: 0.78
      relation: "supports"
  gaps:
    - topic: "실제 구현 사례"
      priority: high
    - topic: "비용 분석"
      priority: medium
---

# 노트 본문...

## 🧠 Connected Insights
> *이 섹션은 OSBA에 의해 자동 생성되었습니다. (2025-12-19)*

### 연결된 노트
- [[AI-Tools]] - 이 노트의 개념을 확장합니다
- [[Productivity]] - 관련 주장을 뒷받침합니다

### 탐구할 주제
- [ ] **실제 구현 사례** (높은 우선순위) - 이론적 설명에 실제 사례 추가 필요
- [ ] **비용 분석** (중간 우선순위) - 경제적 측면 고려 필요
```

---

### 3.3 기능 3: Vault Gap Analysis (전체 갭 분석)

**명령어**: `OSBA: Deep Vault Analysis` (수동 트리거 전용, 비용 경고 표시)

**워크플로우**:
```
┌──────────────────────────────────────────────────────────────────┐
│ 1. [로컬] 사전 검증                                              │
│    - 예상 비용 계산 및 사용자 확인                               │
│    - 전체 노트 수, 예상 토큰, 예상 비용 표시                     │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. [로컬] 전체 노트 메타데이터 수집                              │
│    - 제목, 태그, 기존 링크맵                                     │
│    - 각 노트 요약 생성 (캐시 활용)                               │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. [로컬] 클러스터링 수행                                        │
│    - K-means on embeddings                                       │
│    - 클러스터당 ~20개 노트 그룹화                                │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. [API] 클러스터별 Gap 분석 (배치 처리)                         │
│    - 각 클러스터를 Claude에 개별 전송                            │
│    - 진행률 UI 업데이트                                          │
│    - 실패 시 해당 클러스터만 재시도                              │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. [로컬] 결과 종합                                              │
│    - "Vault Gap Report" 노트 생성                                │
│    - 클러스터 맵 시각화 (Mermaid 다이어그램)                     │
│    - 우선순위별 액션 아이템 목록                                 │
└──────────────────────────────────────────────────────────────────┘
```

**예상 비용**: 500노트 기준 ~$0.50 (25개 클러스터 × $0.02)

---

## 4. 데이터 모델

### 4.1 YAML Frontmatter 스키마

```yaml
---
# ===== 사용자 관리 필드 (기존 유지) =====
title: "노트 제목"
created: 2025-12-19
tags: [ai, obsidian, productivity]
aliases: ["별칭1", "별칭2"]

# ===== OSBA 자동 관리 필드 =====
osba:
  # 메타데이터
  version: 1                              # 스키마 버전
  last_analyzed: 2025-12-19T10:30:00Z     # 마지막 분석 시간
  embedding_id: "emb_abc123"              # SQLite 임베딩 참조 ID
  content_hash: "md5_xyz789"              # 변경 감지용 해시

  # 분석 결과
  confidence_score: 0.85                  # 분석 신뢰도 (0-1)
  word_count: 1234                        # 단어 수

  # 연결 관계
  related:
    - path: "Notes/AI-Tools.md"
      score: 0.92                         # 유사도 점수
      relation: "extends"                 # extends|supports|contradicts|examples
      reason: "AI 도구 개념을 확장"
    - path: "Notes/Productivity.md"
      score: 0.78
      relation: "supports"
      reason: "생산성 주장 뒷받침"

  # 지식 갭
  gaps:
    - topic: "실제 구현 사례"
      priority: high                      # high|medium|low
      reason: "이론 설명만 있고 실제 사례 부족"
    - topic: "비용 분석"
      priority: medium
      reason: "경제적 측면 미고려"

  # 클러스터 소속
  clusters:
    - name: "ai-tools"
      confidence: 0.9
    - name: "productivity"
      confidence: 0.7
---
```

### 4.2 SQLite 데이터베이스 스키마

```sql
-- ===== 노트 메타데이터 테이블 =====
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,           -- Vault 내 상대 경로
    title TEXT,                          -- 노트 제목
    content_hash TEXT,                   -- MD5 해시 (변경 감지)
    word_count INTEGER DEFAULT 0,
    created_at TEXT,                     -- ISO8601
    modified_at TEXT,                    -- ISO8601
    last_analyzed_at TEXT,               -- ISO8601
    summary TEXT,                        -- AI 생성 요약 (캐시)
    INDEX idx_path (path),
    INDEX idx_modified (modified_at)
);

-- ===== 임베딩 벡터 테이블 (sqlite-vec 확장) =====
CREATE VIRTUAL TABLE embeddings USING vec0(
    note_id INTEGER PRIMARY KEY,
    embedding FLOAT[1536]                -- OpenAI embedding 차원
);

-- ===== 연결 관계 테이블 =====
CREATE TABLE connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,         -- extends|supports|contradicts|examples
    score REAL NOT NULL,                 -- 유사도 점수 (0-1)
    reason TEXT,                         -- 연결 이유
    created_at TEXT NOT NULL,
    UNIQUE(source_id, target_id),
    INDEX idx_source (source_id),
    INDEX idx_target (target_id)
);

-- ===== 지식 갭 테이블 =====
CREATE TABLE knowledge_gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    priority TEXT NOT NULL,              -- high|medium|low
    reason TEXT,
    resolved_at TEXT,                    -- 해결 시 타임스탬프
    created_at TEXT NOT NULL,
    INDEX idx_note (note_id),
    INDEX idx_priority (priority)
);

-- ===== 클러스터 테이블 =====
CREATE TABLE clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    centroid BLOB,                       -- 클러스터 중심 벡터
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE note_clusters (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    confidence REAL NOT NULL,            -- 소속 신뢰도 (0-1)
    PRIMARY KEY (note_id, cluster_id)
);

-- ===== 작업 큐 테이블 =====
CREATE TABLE job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,                  -- draft|analyze|gap_analysis|embedding
    status TEXT DEFAULT 'pending',       -- pending|running|completed|failed|cancelled
    priority INTEGER DEFAULT 5,          -- 1(높음) - 10(낮음)
    payload TEXT NOT NULL,               -- JSON: 작업 파라미터
    result TEXT,                         -- JSON: 작업 결과
    error TEXT,                          -- 에러 메시지
    progress REAL DEFAULT 0,             -- 진행률 (0-100)
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    INDEX idx_status (status),
    INDEX idx_priority (priority)
);

-- ===== 비용 추적 테이블 =====
CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER REFERENCES job_queue(id),
    model TEXT NOT NULL,                 -- 사용 모델명
    provider TEXT NOT NULL,              -- google|anthropic|openai
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,              -- 계산된 비용
    created_at TEXT NOT NULL,
    INDEX idx_date (created_at),
    INDEX idx_model (model)
);

-- ===== 캐시 테이블 =====
CREATE TABLE cache (
    key TEXT PRIMARY KEY,                -- 캐시 키
    value TEXT NOT NULL,                 -- JSON 값
    expires_at TEXT NOT NULL,            -- 만료 시간
    created_at TEXT NOT NULL
);

-- ===== 뷰: 일별 비용 집계 =====
CREATE VIEW daily_costs AS
SELECT
    DATE(created_at) as date,
    SUM(cost_usd) as total_cost,
    COUNT(*) as request_count,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens
FROM usage_log
GROUP BY DATE(created_at);
```

---

## 5. API 추상화 레이어

### 5.1 인터페이스 정의

```typescript
// src/api/types.ts

export interface AIProvider {
  name: string;

  // 텍스트 생성
  generateText(prompt: string, options: GenerateOptions): Promise<GenerateResult>;

  // 임베딩 생성
  generateEmbedding(text: string): Promise<EmbeddingResult>;

  // 비용 추정
  estimateCost(inputTokens: number, outputTokens: number): number;

  // 모델 가용성 확인
  isAvailable(): Promise<boolean>;
}

export interface GenerateOptions {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
  timeout?: number;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  latencyMs: number;
}

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
  cost: number;
  model: string;
}

// 작업 복잡도에 따른 모델 자동 선택
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export const MODEL_SELECTION: Record<TaskComplexity, { primary: string; fallback: string }> = {
  simple: {
    primary: 'gemini-2.0-flash-exp',
    fallback: 'gpt-4o-mini'
  },
  moderate: {
    primary: 'gemini-1.5-pro',
    fallback: 'claude-3-5-sonnet'
  },
  complex: {
    primary: 'claude-3-5-sonnet',
    fallback: 'gpt-4o'
  }
};
```

### 5.2 Provider 구현 (예: Gemini)

```typescript
// src/api/providers/gemini.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, GenerateOptions, GenerateResult, EmbeddingResult } from '../types';

export class GeminiProvider implements AIProvider {
  name = 'google';
  private client: GoogleGenerativeAI;

  // 비용 테이블 (USD per 1M tokens)
  private costs = {
    'gemini-2.0-flash-exp': { input: 0.075, output: 0.30 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    'gemini-1.5-pro': { input: 1.25, output: 5.00 }
  };

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generateText(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const model = this.client.getGenerativeModel({ model: options.model });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature
      },
      systemInstruction: options.systemPrompt
    });

    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      text,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
      cost: this.estimateCost(
        usage?.promptTokenCount || 0,
        usage?.candidatesTokenCount || 0,
        options.model
      ),
      model: options.model,
      latencyMs: Date.now() - startTime
    };
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const model = this.client.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);

    return {
      embedding: result.embedding.values,
      tokens: Math.ceil(text.length / 4), // 추정
      cost: 0, // Gemini 임베딩은 현재 무료
      model: 'text-embedding-004'
    };
  }

  estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const modelCost = this.costs[model || 'gemini-2.0-flash-exp'];
    return (inputTokens * modelCost.input + outputTokens * modelCost.output) / 1_000_000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
      await model.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }
}
```

### 5.3 API 오케스트레이터

```typescript
// src/api/orchestrator.ts

import { AIProvider, TaskComplexity, MODEL_SELECTION, GenerateResult } from './types';
import { GeminiProvider } from './providers/gemini';
import { ClaudeProvider } from './providers/claude';
import { OpenAIProvider } from './providers/openai';

export class APIOrchestrator {
  private providers: Map<string, AIProvider> = new Map();
  private usageLog: UsageLogger;

  constructor(config: APIConfig) {
    if (config.geminiApiKey) {
      this.providers.set('google', new GeminiProvider(config.geminiApiKey));
    }
    if (config.claudeApiKey) {
      this.providers.set('anthropic', new ClaudeProvider(config.claudeApiKey));
    }
    if (config.openaiApiKey) {
      this.providers.set('openai', new OpenAIProvider(config.openaiApiKey));
    }
    this.usageLog = new UsageLogger();
  }

  async generate(
    prompt: string,
    complexity: TaskComplexity,
    options?: Partial<GenerateOptions>
  ): Promise<GenerateResult> {
    const modelConfig = MODEL_SELECTION[complexity];

    // 1차 시도: Primary 모델
    try {
      const result = await this.tryGenerate(prompt, modelConfig.primary, options);
      await this.usageLog.log(result);
      return result;
    } catch (error) {
      console.warn(`Primary model failed: ${modelConfig.primary}`, error);
    }

    // 2차 시도: Fallback 모델
    try {
      const result = await this.tryGenerate(prompt, modelConfig.fallback, options);
      await this.usageLog.log(result);
      return result;
    } catch (error) {
      throw new Error(`All models failed for complexity: ${complexity}`);
    }
  }

  private async tryGenerate(
    prompt: string,
    model: string,
    options?: Partial<GenerateOptions>
  ): Promise<GenerateResult> {
    const provider = this.getProviderForModel(model);

    return await provider.generateText(prompt, {
      model,
      maxTokens: options?.maxTokens || 2000,
      temperature: options?.temperature || 0.7,
      systemPrompt: options?.systemPrompt,
      responseFormat: options?.responseFormat || 'text'
    });
  }

  private getProviderForModel(model: string): AIProvider {
    if (model.startsWith('gemini')) return this.providers.get('google')!;
    if (model.startsWith('claude')) return this.providers.get('anthropic')!;
    if (model.startsWith('gpt')) return this.providers.get('openai')!;
    throw new Error(`Unknown model: ${model}`);
  }

  // 비용 체크 및 예산 관리
  async checkBudget(estimatedCost: number): Promise<{ allowed: boolean; remaining: number }> {
    const dailyUsage = await this.usageLog.getDailyTotal();
    const dailyLimit = 1.00; // $1/day 기본 제한

    return {
      allowed: dailyUsage + estimatedCost <= dailyLimit,
      remaining: dailyLimit - dailyUsage
    };
  }
}
```

---

## 6. 에러 핸들링 및 보안

### 6.1 3단계 에러 복구 전략

```typescript
// src/core/error-handler.ts

export const ERROR_RECOVERY_CONFIG = {
  // Level 1: 자동 재시도 (일시적 오류)
  TRANSIENT: {
    maxRetries: 3,
    backoffMs: [1000, 3000, 10000],  // 지수 백오프
    retryableErrors: [
      'RATE_LIMIT_EXCEEDED',
      'TIMEOUT',
      'NETWORK_ERROR',
      'SERVICE_UNAVAILABLE'
    ]
  },

  // Level 2: Fallback 모델 (특정 모델 실패)
  MODEL_FALLBACK: {
    'claude-3-5-sonnet': 'gemini-1.5-pro',
    'gemini-2.0-flash-exp': 'gpt-4o-mini',
    'gpt-4o': 'claude-3-5-sonnet'
  },

  // Level 3: 부분 완료 저장 (치명적 오류)
  PARTIAL_SAVE: {
    enabled: true,
    checkpointInterval: 5,  // 5개 아이템마다 체크포인트
    recoveryPath: '.obsidian/plugins/osba/recovery/'
  }
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = ERROR_RECOVERY_CONFIG.TRANSIENT;
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < config.maxRetries - 1) {
        await sleep(config.backoffMs[attempt]);
        console.log(`Retry attempt ${attempt + 1}/${config.maxRetries}`);
      }
    }
  }

  // Fallback 모델 시도
  if (options.fallbackModel) {
    console.log(`Trying fallback model: ${options.fallbackModel}`);
    return await fn(); // fallback 모델로 재시도
  }

  throw lastError!;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    return ERROR_RECOVERY_CONFIG.TRANSIENT.retryableErrors.some(
      code => error.message.includes(code)
    );
  }
  return false;
}
```

### 6.2 보안 설정

```typescript
// src/core/security.ts

export const SECURITY_CONFIG = {
  // API 키 저장 방식
  keyStorage: {
    method: 'obsidian-data',  // Obsidian의 data.json 사용
    encryption: false          // Obsidian이 이미 로컬 저장
  },

  // 로깅 정책
  logging: {
    maskApiKeys: true,
    maskUserContent: true,    // 프로덕션에서는 true
    logLevel: 'info',
    maxLogSize: '10MB'
  },

  // API 호출 제한 (사용자 보호)
  rateLimits: {
    maxRequestsPerMinute: 30,
    maxTokensPerDay: 500_000,
    requireConfirmationAbove: 10_000  // 10K 토큰 이상 시 확인
  },

  // 데이터 전송 정책
  contentPolicy: {
    // 이 폴더의 노트는 API로 전송하지 않음
    excludeFolders: [
      'Private/',
      'Secrets/',
      'Personal/',
      '.obsidian/'
    ],

    // 이 태그가 있는 노트는 API로 전송하지 않음
    excludeTags: [
      '#private',
      '#sensitive',
      '#secret',
      '#personal'
    ],

    // 50KB 이상 노트는 요약 후 전송
    maxNoteSize: 50_000,

    // 이미지, 첨부파일 제외
    excludeAttachments: true
  },

  // 확인 필요 작업
  confirmationRequired: {
    vaultWideAnalysis: true,     // 전체 Vault 분석
    bulkOperations: true,        // 10개 이상 노트 일괄 처리
    highCostOperations: true     // $0.10 이상 예상 비용
  }
};

// 노트 필터링 함수
export function shouldExcludeNote(note: NoteMetadata): boolean {
  const config = SECURITY_CONFIG.contentPolicy;

  // 폴더 체크
  if (config.excludeFolders.some(folder => note.path.startsWith(folder))) {
    return true;
  }

  // 태그 체크
  if (note.tags?.some(tag => config.excludeTags.includes(tag))) {
    return true;
  }

  // 크기 체크 (경고만, 제외는 아님)
  if (note.size > config.maxNoteSize) {
    console.warn(`Note ${note.path} exceeds size limit, will be summarized`);
  }

  return false;
}
```

---

## 7. 비용 최적화 전략

### 7.1 캐싱 시스템

```typescript
// src/core/cache.ts

export const CACHE_CONFIG = {
  // 임베딩 캐시: 노트 내용 변경 시만 갱신
  embedding: {
    enabled: true,
    invalidateOn: 'content_change',  // content_hash 비교
    storage: 'sqlite'
  },

  // 응답 캐시: 동일 프롬프트에 대한 응답 재사용
  response: {
    enabled: true,
    ttl: 24 * 60 * 60 * 1000,  // 24시간
    maxSize: 1000,              // 최대 1000개 캐시
    keyStrategy: 'prompt_hash'
  },

  // 요약 캐시: 노트 요약 저장
  summary: {
    enabled: true,
    invalidateOn: 'content_change',
    maxLength: 500  // 요약 최대 길이
  }
};

export class CacheManager {
  private responseCache: LRUCache<string, CachedResponse>;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.responseCache = new LRUCache({
      max: CACHE_CONFIG.response.maxSize,
      ttl: CACHE_CONFIG.response.ttl
    });
  }

  // 임베딩 캐시 조회/저장
  async getEmbedding(noteId: number): Promise<number[] | null> {
    const result = this.db.prepare(`
      SELECT embedding FROM embeddings WHERE note_id = ?
    `).get(noteId);
    return result?.embedding || null;
  }

  async setEmbedding(noteId: number, embedding: number[]): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (note_id, embedding)
      VALUES (?, ?)
    `).run(noteId, embedding);
  }

  // 응답 캐시
  getResponse(promptHash: string): GenerateResult | null {
    return this.responseCache.get(promptHash) || null;
  }

  setResponse(promptHash: string, result: GenerateResult): void {
    this.responseCache.set(promptHash, result);
  }

  // 캐시 통계
  getStats(): CacheStats {
    return {
      embeddingCount: this.db.prepare('SELECT COUNT(*) FROM embeddings').get(),
      responseHits: this.responseCache.hits,
      responseMisses: this.responseCache.misses,
      hitRate: this.responseCache.hits / (this.responseCache.hits + this.responseCache.misses)
    };
  }
}
```

### 7.2 비용 추적 대시보드

```typescript
// src/ui/cost-dashboard.ts

export interface CostDashboardData {
  today: {
    totalCost: number;
    requestCount: number;
    tokenUsage: { input: number; output: number };
    byModel: Record<string, number>;
  };
  thisWeek: {
    dailyCosts: Array<{ date: string; cost: number }>;
    totalCost: number;
  };
  thisMonth: {
    totalCost: number;
    averageDaily: number;
    projectedMonthly: number;
  };
  budgetStatus: {
    dailyLimit: number;
    remaining: number;
    percentUsed: number;
    warning: boolean;
  };
}

export class CostDashboard {
  private db: Database;

  async getData(): Promise<CostDashboardData> {
    const today = new Date().toISOString().split('T')[0];

    // 오늘 사용량
    const todayUsage = this.db.prepare(`
      SELECT
        SUM(cost_usd) as total_cost,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        model,
        SUM(cost_usd) as model_cost
      FROM usage_log
      WHERE DATE(created_at) = ?
      GROUP BY model
    `).all(today);

    // 이번 주 일별 비용
    const weekCosts = this.db.prepare(`
      SELECT DATE(created_at) as date, SUM(cost_usd) as cost
      FROM usage_log
      WHERE created_at >= DATE('now', '-7 days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all();

    // ... 나머지 집계

    return {
      today: {
        totalCost: todayUsage.reduce((sum, r) => sum + r.total_cost, 0),
        requestCount: todayUsage.reduce((sum, r) => sum + r.request_count, 0),
        tokenUsage: {
          input: todayUsage.reduce((sum, r) => sum + r.input_tokens, 0),
          output: todayUsage.reduce((sum, r) => sum + r.output_tokens, 0)
        },
        byModel: Object.fromEntries(todayUsage.map(r => [r.model, r.model_cost]))
      },
      // ... 나머지 데이터
    };
  }
}
```

### 7.3 자동 모델 선택 로직

```typescript
// src/core/model-selector.ts

export function selectOptimalModel(task: TaskType, context: TaskContext): ModelSelection {
  // 작업 복잡도 점수 계산
  const complexityScore = calculateComplexity(task, context);

  // 예산 상태 확인
  const budgetStatus = context.budgetRemaining / context.dailyLimit;

  // 복잡도별 기본 모델
  let model: string;
  if (complexityScore < 0.3) {
    model = 'gemini-2.0-flash-exp';  // 간단한 작업: 가장 저렴한 모델
  } else if (complexityScore < 0.7) {
    model = 'gemini-1.5-pro';        // 중간 작업: 균형 모델
  } else {
    model = 'claude-3-5-sonnet';     // 복잡한 작업: 최고 성능
  }

  // 예산이 부족하면 저비용 모델로 다운그레이드
  if (budgetStatus < 0.3 && model !== 'gemini-2.0-flash-exp') {
    console.log('Budget low, downgrading to flash model');
    model = 'gemini-2.0-flash-exp';
  }

  // 비용 추정
  const estimatedCost = estimateCost(model, context.estimatedTokens);

  return {
    model,
    estimatedCost,
    reasoning: `Complexity: ${complexityScore.toFixed(2)}, Budget: ${(budgetStatus * 100).toFixed(0)}%`
  };
}

function calculateComplexity(task: TaskType, context: TaskContext): number {
  let score = 0;

  // 작업 유형별 기본 복잡도
  const baseComplexity: Record<TaskType, number> = {
    'draft': 0.2,
    'polish': 0.3,
    'analyze': 0.6,
    'gap_analysis': 0.9
  };
  score += baseComplexity[task] || 0.5;

  // 컨텍스트 크기에 따른 조정
  if (context.noteCount > 50) score += 0.2;
  if (context.estimatedTokens > 5000) score += 0.1;

  // JSON 응답 필요 시 복잡도 증가
  if (context.requiresJson) score += 0.1;

  return Math.min(1, score);
}
```

---

## 8. 구현 로드맵

### Phase 1: Foundation (2-3주)

**목표**: 핵심 인프라 구축

| 태스크 | 우선순위 | 예상 시간 |
|--------|---------|----------|
| Obsidian 플러그인 스캐폴딩 | P0 | 2일 |
| SQLite 초기화 및 마이그레이션 | P0 | 2일 |
| 설정 패널 UI | P0 | 3일 |
| API Provider 추상화 레이어 | P0 | 3일 |
| 기본 Command Palette 명령어 | P1 | 2일 |
| Worker Thread 설정 | P1 | 2일 |

**검증 기준**:
- [ ] 플러그인 로드 및 설정 저장/불러오기 동작
- [ ] SQLite 데이터베이스 생성 및 쿼리 성공
- [ ] API 키 저장 및 연결 테스트 통과

---

### Phase 2: Quick Draft (1-2주)

**목표**: 첫 번째 사용 가능 기능 완성

| 태스크 | 우선순위 | 예상 시간 |
|--------|---------|----------|
| Gemini API 연동 | P0 | 2일 |
| 프롬프트 입력 모달 | P0 | 1일 |
| 마크다운 응답 처리 | P0 | 1일 |
| 노트 생성/삽입 로직 | P0 | 2일 |
| 에러 핸들링 및 재시도 | P1 | 2일 |

**검증 기준**:
- [ ] "AI 도구에 대한 노트 작성해줘" → 새 노트 생성 성공
- [ ] 기존 노트에서 "이 내용을 요약해줘" → 하단에 삽입 성공
- [ ] API 실패 시 적절한 에러 메시지 표시

---

### Phase 3: Embedding & Search (2-3주)

**목표**: 로컬 벡터 검색 구현

| 태스크 | 우선순위 | 예상 시간 |
|--------|---------|----------|
| OpenAI Embedding API 연동 | P0 | 2일 |
| sqlite-vec 확장 통합 | P0 | 3일 |
| 노트 변경 감지 및 자동 업데이트 | P0 | 3일 |
| 유사 노트 검색 기능 | P0 | 2일 |
| 임베딩 캐싱 및 최적화 | P1 | 2일 |

**검증 기준**:
- [ ] 1000개 노트 임베딩 생성 < 5분
- [ ] 유사 노트 검색 응답 < 100ms
- [ ] 노트 수정 시 임베딩 자동 갱신

---

### Phase 4: Connection Analyzer (2-3주)

**목표**: 핵심 차별화 기능 완성

| 태스크 | 우선순위 | 예상 시간 |
|--------|---------|----------|
| Claude API 연동 | P0 | 2일 |
| RAG 컨텍스트 구성 로직 | P0 | 3일 |
| 연결 분석 프롬프트 최적화 | P0 | 3일 |
| YAML frontmatter 자동 업데이트 | P0 | 2일 |
| "Connected Insights" 섹션 생성 | P0 | 2일 |
| 새 노트 자동 분석 옵션 | P1 | 2일 |

**검증 기준**:
- [ ] 분석 결과 JSON 파싱 성공률 > 95%
- [ ] YAML 업데이트 후 Obsidian 정상 파싱
- [ ] 비용 < $0.05/분석 요청

---

### Phase 5: Job Queue & Dashboard (1-2주)

**목표**: 비동기 작업 관리 UX

| 태스크 | 우선순위 | 예상 시간 |
|--------|---------|----------|
| 사이드바 Job Queue 뷰 | P0 | 3일 |
| 작업 진행률 표시 | P0 | 2일 |
| 작업 취소 기능 | P1 | 1일 |
| 비용 추적 대시보드 | P1 | 2일 |

**검증 기준**:
- [ ] 동시 작업 3개 이상 관리 가능
- [ ] 작업 취소 시 리소스 정리 완료
- [ ] 비용 추적 정확도 > 99%

---

### Phase 6: Gap Analysis & Polish (2주)

**목표**: 고급 기능 및 최적화

| 태스크 | 우선순위 | 예상 시간 |
|--------|---------|----------|
| Vault 전체 Gap 분석 | P1 | 4일 |
| 클러스터링 및 시각화 | P2 | 3일 |
| 성능 최적화 | P1 | 3일 |
| 문서화 및 릴리스 준비 | P1 | 2일 |

---

### 총 예상 기간

| 범위 | 기간 | 포함 기능 |
|------|------|----------|
| **MVP** | 8-10주 | Quick Draft, Connection Analyzer, 기본 UI |
| **Full v1.0** | 12-15주 | MVP + Job Queue, Gap Analysis, 비용 대시보드 |

---

## 9. 성공 지표 (KPIs)

### 9.1 기능적 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| Quick Draft 성공률 | > 95% | API 응답 성공 / 요청 수 |
| 분석 정확도 | > 80% | 사용자 피드백 기반 |
| 응답 시간 (Quick Draft) | < 5초 | 평균 latency |
| 응답 시간 (Analysis) | < 30초 | 평균 latency |

### 9.2 비용 효율성 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| Quick Draft 비용 | < $0.001/요청 | API 비용 로그 |
| Connection Analysis 비용 | < $0.05/요청 | API 비용 로그 |
| 캐시 히트율 | > 60% | 캐시 통계 |
| 월간 평균 비용 (일반 사용) | < $5 | 사용자 리포트 |

### 9.3 사용자 경험 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| 첫 분석까지 시간 | < 2분 | 온보딩 추적 |
| 일일 활성 사용 | > 50% 설치자 | 텔레메트리 |
| 에러 발생률 | < 1% | 에러 로그 |

---

## 10. 리스크 및 대응 방안

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|----------|
| sqlite-vec 호환성 문제 | 높음 | 순수 JS 벡터 검색 대안 준비 |
| API 비용 초과 | 중간 | 강력한 예산 제한 + 경고 시스템 |
| 대규모 Vault 성능 저하 | 중간 | 증분 처리 + 배치 최적화 |
| API Rate Limit | 낮음 | 지수 백오프 + 큐잉 시스템 |
| 사용자 데이터 프라이버시 | 높음 | 로컬 처리 우선 + 명시적 제외 설정 |

---

## 부록: 프롬프트 엔지니어링 가이드

### A.1 Quick Draft 프롬프트

```markdown
# System Prompt
당신은 Obsidian 지식 관리 전문가입니다. 사용자의 요청에 따라 마크다운 노트를 작성합니다.

## 규칙
1. Obsidian 마크다운 문법을 사용합니다
2. [[wikilink]] 형식으로 다른 노트와 연결합니다
3. #태그 를 적절히 포함합니다
4. 구조화된 헤더(##, ###)를 사용합니다
5. 코드 블록, 인용, 리스트를 적절히 활용합니다

## 출력 형식
- YAML frontmatter는 포함하지 않습니다
- 마크다운 본문만 작성합니다
- 첫 줄은 # 제목으로 시작합니다
```

### A.2 Connection Analysis 프롬프트

```markdown
# System Prompt
당신은 지식 관리 및 연결 분석 전문가입니다. 노트 간의 관계를 분석하고 지식 갭을 발견합니다.

## 관계 유형 정의
- extends: 대상 노트의 개념을 확장하거나 심화
- supports: 대상 노트의 주장을 뒷받침
- contradicts: 대상 노트와 상반된 관점 제시
- examples: 대상 노트의 구체적 사례 제공

## 분석 기준
1. 주제적 연관성: 동일하거나 관련된 주제를 다루는가
2. 논리적 연결: 인과관계, 전제-결론 관계가 있는가
3. 시간적 연결: 순차적 발전, 버전 관계가 있는가
4. 참조 관계: 명시적/암시적 참조가 있는가

## 갭 분석 기준
1. 누락된 정의: 용어가 사용되었지만 정의되지 않음
2. 누락된 예시: 개념이 설명되었지만 예시가 없음
3. 누락된 반론: 주장이 있지만 반대 의견이 없음
4. 누락된 연결: 관련 주제가 언급되지 않음

## 출력 형식
반드시 다음 JSON 구조로 응답하세요:
{
  "relations": [...],
  "gaps": [...],
  "backlinks": [...]
}
```

---

> **문서 끝**
> 이 명세서는 실제 구현을 위한 기술적 가이드라인입니다.
> 구현 중 발견되는 문제는 이 문서를 업데이트하여 반영합니다.
