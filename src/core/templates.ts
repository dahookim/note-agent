/**
 * Template Definitions for Obsidian AI Agent
 */

export type TemplateType =
    // easy-gate templates
    | 'basic-summary' | 'study-note' | 'analysis-report' | 'idea-note' | 'action-items' | 'qa-format'
    // stargate templates
    | 'briefing' | 'concept' | 'insight' | 'knowledge-map' | 'deep-analysis' | 'meta-hub' | 'comprehensive'
    // custom
    | 'custom'

export interface AnalysisTemplate {
    id: TemplateType | string
    name: string
    icon: string
    description: string
    systemPrompt?: string
    userPromptTemplate: string
}

export const ANALYSIS_TEMPLATES: AnalysisTemplate[] = [
    // ============================================
    // Easy Gate Templates (6)
    // ============================================
    {
        id: 'basic-summary',
        name: '기본 요약',
        icon: '📋',
        description: '페이지 내용을 간결하게 요약합니다.',
        userPromptTemplate: `다음 웹 페이지 내용을 한국어로 요약해주세요:

## 요약 요구사항
- 핵심 내용을 3-5개의 주요 포인트로 정리
- 중요한 정보와 결론을 강조
- 전문 용어는 간단히 설명 추가

## 원본 내용
{{content}}`
    },
    {
        id: 'study-note',
        name: '학습 노트',
        icon: '📚',
        description: '학습에 최적화된 형태로 정리합니다.',
        userPromptTemplate: `다음 내용을 학습 노트 형태로 정리해주세요:

## 정리 형식
1. **핵심 개념**: 주요 개념과 정의
2. **중요 포인트**: 기억해야 할 핵심 사항
3. **예시/사례**: 이해를 돕는 구체적 예시
4. **질문 & 답변**: 자주 묻는 질문 형태로 정리
5. **복습 키워드**: 복습용 키워드 목록

## 원본 내용
{{content}}`
    },
    {
        id: 'analysis-report',
        name: '분석 리포트',
        icon: '📊',
        description: '심층 분석 리포트를 생성합니다.',
        userPromptTemplate: `다음 내용을 분석 리포트 형태로 작성해주세요:

## 리포트 구조
1. **개요**: 문서의 핵심 주제와 목적
2. **주요 발견사항**: 중요한 정보와 데이터
3. **분석**: 내용에 대한 심층 분석
4. **시사점**: 도출할 수 있는 인사이트
5. **결론 및 제안**: 최종 결론과 활용 방안

## 원본 내용
{{content}}`
    },
    {
        id: 'idea-note',
        name: '아이디어 노트',
        icon: '💡',
        description: '아이디어 발굴 및 확장에 초점을 맞춥니다.',
        userPromptTemplate: `다음 내용에서 아이디어를 발굴하고 확장해주세요:

## 아이디어 정리
1. **핵심 아이디어**: 문서의 중심 아이디어
2. **관련 아이디어**: 연관된 추가 아이디어
3. **적용 방안**: 실제 적용할 수 있는 방법
4. **발전 가능성**: 더 발전시킬 수 있는 방향
5. **연결점**: 다른 분야와의 연결 가능성

## 원본 내용
{{content}}`
    },
    {
        id: 'action-items',
        name: '액션 아이템',
        icon: '✅',
        description: '실행 가능한 태스크 목록을 추출합니다.',
        userPromptTemplate: `다음 내용에서 실행 가능한 액션 아이템을 추출해주세요:

## 액션 아이템 형식
- [ ] 즉시 실행 가능한 태스크
- [ ] 단기 목표 (1주일 내)
- [ ] 중기 목표 (1개월 내)
- [ ] 장기 목표

각 항목에 우선순위와 예상 소요시간을 추가해주세요.

## 원본 내용
{{content}}`
    },
    {
        id: 'qa-format',
        name: 'Q&A 형식',
        icon: '❓',
        description: '질문과 답변 형태로 재구성합니다.',
        userPromptTemplate: `다음 내용을 Q&A 형식으로 재구성해주세요:

## Q&A 형식
Q1: [핵심 질문]
A1: [상세한 답변]

Q2: ...

최소 5개의 Q&A 쌍을 생성하고,
내용의 핵심을 파악할 수 있는 질문을 만들어주세요.

## 원본 내용
{{content}}`
    },

    // ============================================
    // Stargate Templates (7)
    // ============================================
    {
        id: 'briefing',
        name: '브리핑',
        icon: '📰',
        description: '브리핑 문서, 뉴스, 리포트 내용을 빠르게 파악합니다.',
        systemPrompt: `You are a briefing and summarization specialist.
Focus on clarity, context, and fast understanding.
Extract 핵심 메시지, 배경, 의미를 구조적으로 정리하세요.
Use the Feynman Technique to ensure explainability.
Avoid unnecessary details and emotional language.`,
        userPromptTemplate: `다음 내용을 브리핑 노트 형식으로 정리해주세요.

## 브리핑 노트 구성
1. 🎯 핵심 내용 요약 (5~7줄)
2. 📌 주요 포인트
   - 배경
   - 핵심 내용
   - 시사점
3. 🧠 파인만 기법으로 이해하기
   - 쉬운 설명
   - 비유 또는 예시
4. ❓ 핵심 질문 2~3개

## 내용
{{content}}`
    },
    {
        id: 'concept',
        name: '개념정리',
        icon: '📘',
        description: '이론·개념 중심의 기준 지식을 정리합니다.',
        systemPrompt: `You are a conceptual knowledge architect.
Define concepts clearly and explain their internal structure.
Highlight relationships between concepts.
Use the Feynman Technique to simplify without losing accuracy.
Prioritize precision over breadth.`,
        userPromptTemplate: `다음 내용을 개념 노트 형식으로 정리해주세요.

## 개념 노트 구성
1. 🔑 핵심 개념 정의
2. 🧩 개념 구조
   - 구성 요소
   - 작동 원리 또는 논리 흐름
3. 🔗 관련 개념 및 대비
4. 🧠 파인만 기법 설명
   - 쉬운 설명
   - 오해하기 쉬운 포인트
5. 📌 요약 정리

## 내용
{{content}}`
    },
    {
        id: 'insight',
        name: '인사이트',
        icon: '💡',
        description: '정보를 넘어 사고를 확장합니다.',
        systemPrompt: `You are an insight generation facilitator.
Go beyond surface information to extract meaning.
Encourage new perspectives and connections.
Focus on implications, patterns, and thinking expansion.`,
        userPromptTemplate: `다음 내용을 인사이트 노트로 확장해주세요.

## 인사이트 노트 구성
1. 🎯 핵심 인사이트
2. 🔍 숨겨진 의미 또는 패턴
3. 🔗 연결되는 개념 / 분야
4. 🚀 확장 아이디어
5. ❓ 사고를 확장하는 질문 2~3개

## 내용
{{content}}`
    },
    {
        id: 'knowledge-map',
        name: '지식맵',
        icon: '🗺️',
        description: '지식을 구조적으로 배치합니다.',
        systemPrompt: `You are a knowledge mapping specialist.
Organize information spatially and structurally.
Focus on hierarchy, sequence, and relationships.
Prepare content suitable for mind maps or diagrams.`,
        userPromptTemplate: `다음 내용을 지식맵 노트로 구조화해주세요.

## 지식맵 노트 구성
1. 🧠 중심 주제
2. 🌿 하위 개념 트리
3. ⏱️ 타임라인 또는 흐름 (있다면)
4. 🔗 개념 간 관계
5. 📌 구조 요약

## 내용
{{content}}`
    },
    {
        id: 'deep-analysis',
        name: '심층분석',
        icon: '🔬',
        description: '조사, 비교, 문제 해결을 위한 분석 노트입니다.',
        systemPrompt: `You are an analytical research assistant.
Break down problems systematically.
Compare options, identify causes, and evaluate outcomes.
Present structured and evidence-based analysis.`,
        userPromptTemplate: `다음 내용을 심층분석 노트로 정리해주세요.

## 심층분석 노트 구성
1. 🎯 분석 대상 및 문제 정의
2. 🔍 주요 쟁점 분석
3. ⚖️ 비교 또는 대안 평가
4. 📊 근거 및 논리 정리
5. 🧠 결론 및 시사점

## 내용
{{content}}`
    },
    {
        id: 'meta-hub',
        name: '메타허브',
        icon: '🧠',
        description: '지식을 연결하고 관리하는 메타 노트입니다.',
        systemPrompt: `You are a meta-knowledge organizer.
Create structure across multiple notes.
Identify categories, links, and navigation paths.
Design content suitable for MOC (Map of Content).`,
        userPromptTemplate: `다음 내용을 메타허브(MOC) 노트로 정리해주세요.

## 메타허브 노트 구성
1. 🧠 핵심 주제 요약
2. 🗂️ 하위 노트 분류
3. 🔗 연결 구조 (링크 관계 설명)
4. 🧭 탐색 가이드
5. 📌 전체 구조 요약

## 내용
{{content}}`
    },
    {
        id: 'comprehensive',
        name: '종합분석',
        icon: '🎯',
        description: '브리핑, 개념, 인사이트 분석을 종합합니다.',
        systemPrompt: `You are a senior knowledge synthesizer and systems-thinking analyst.
Integrate multiple perspectives into a coherent whole.
Combine summary, conceptual structure, insights, analysis, and meta-organization.
Focus on relationships, patterns, trade-offs, and overarching conclusions.
Think in terms of systems, not isolated facts.
Produce a clear, structured, and navigable synthesis.`,
        userPromptTemplate: `다음 내용을 종합분석 노트 형식으로 정리해주세요.
(브리핑·개념·인사이트·분석·지식맵·메타 관점을 통합하는 상위 노트입니다)

## 종합분석 노트 구성

1. 🎯 전체 개요 (Executive Overview)
- 이 주제를 한 단락으로 요약
- 왜 중요한지, 어떤 범위를 다루는지 명확히 제시

2. 🧾 핵심 내용 종합 요약
- 주요 사실, 주장, 정보들을 브리핑 관점에서 정리
- 세부보다는 큰 흐름 중심

3. 📘 핵심 개념 구조
- 이 주제를 구성하는 주요 개념들
- 개념 간 관계, 계층, 대비 구조 설명

4. 💡 핵심 인사이트 통합
- 개별 인사이트들을 묶어 도출되는 상위 통찰
- 반복되는 패턴, 숨겨진 전제, 관점의 전환

5. 🗺️ 지식 구조 맵 (텍스트 기반)
- 중심 개념 → 하위 영역 → 세부 주제 구조
- 타임라인, 흐름, 원인-결과 관계가 있다면 함께 제시

6. 🔬 심층 분석 요약
- 주요 쟁점 또는 문제
- 선택지/대안/트레이드오프
- 한계점과 리스크

7. 🧠 메타 관점 정리
- 이 주제가 전체 지식 체계에서 차지하는 위치
- 다른 노트/분야와의 연결 포인트
- 향후 확장 가능한 방향

8. 🚀 결론 및 활용 방향
- 현재 시점에서의 종합적 결론
- 학습, 실무, 사고 확장 측면에서의 활용 제안
- 다음에 생성하거나 연결하면 좋은 노트 제안

## 내용
{{content}}`
    }
]

export function getTemplateById(id: string): AnalysisTemplate | undefined {
    return ANALYSIS_TEMPLATES.find((t) => t.id === id)
}

export function renderPrompt(template: AnalysisTemplate, content: string): string {
    return template.userPromptTemplate.replace('{{content}}', content)
}
