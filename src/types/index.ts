/**
 * OSBA Type Definitions
 * Note Agent
 */

// ============================================
// Plugin Settings
// ============================================

export interface OSBASettings {
  // API Keys
  geminiApiKey: string;
  claudeApiKey: string;
  openaiApiKey: string;
  xaiApiKey: string;  // xAI Grok API key

  // Mode Selection
  quickDraftModel: string;
  analysisModel: string;
  embeddingModel: string;

  // Custom API Models (OpenAI Compatible)
  customApiModels: CustomAPIModel[];

  useCustomModels: boolean;
  customQuickDraftModel: string;
  customAnalysisModel: string;

  // Template & UI Upgrades
  savedPrompts: SavedPrompt[];
  defaultInsertionMode: InsertionMode;
  defaultOutputLanguage: string;

  // Budget Settings
  dailyBudgetLimit: number;  // USD
  monthlyBudgetLimit: number;
  enableBudgetAlerts: boolean;
  budgetAlertThreshold: number;  // percentage (0-100)

  // Processing Settings
  indexingMode: 'exclude' | 'include';  // 제외 모드 또는 포함 모드
  excludedFolders: string[];
  includedFolders: string[];  // 포함 모드일 때 인덱싱할 폴더들
  excludedTags: string[];
  maxNoteSize: number;  // bytes
  batchSize: number;

  // Feature Toggles
  autoAnalyzeOnCreate: boolean;
  autoEmbedOnModify: boolean;
  enableCostTracking: boolean;

  // Advanced
  debugMode: boolean;
  cacheEnabled: boolean;
  cacheTTL: number;  // seconds
}

export const DEFAULT_SETTINGS: OSBASettings = {
  geminiApiKey: '',
  claudeApiKey: '',
  openaiApiKey: '',
  xaiApiKey: '',

  quickDraftModel: 'gemini-2.5-flash',
  analysisModel: 'claude-sonnet-4',
  embeddingModel: 'openai-small',

  customApiModels: [],

  useCustomModels: false,
  customQuickDraftModel: '',
  customAnalysisModel: '',

  savedPrompts: [],
  defaultInsertionMode: 'new-note',
  defaultOutputLanguage: 'Auto',

  dailyBudgetLimit: 1.00,
  monthlyBudgetLimit: 10.00,
  enableBudgetAlerts: true,
  budgetAlertThreshold: 80,

  indexingMode: 'exclude',  // 기본값: 제외 모드
  excludedFolders: ['templates', '.obsidian'],
  includedFolders: [],  // 포함 모드일 때 사용
  excludedTags: ['private', 'draft'],
  maxNoteSize: 200 * 1024,  // 200KB (increased from 50KB)
  batchSize: 10,

  autoAnalyzeOnCreate: false,  // Default OFF to prevent unexpected API costs
  autoEmbedOnModify: true,
  enableCostTracking: true,

  debugMode: false,
  cacheEnabled: true,
  cacheTTL: 3600,
};

// ============================================
// AI Provider Types
// ============================================

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  systemPrompt?: string;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  finishReason: 'stop' | 'length' | 'error';
}

export interface EmbeddingResult {
  embedding: number[];
  inputTokens: number;
  cost: number;
  model: string;
  dimensions: number;
}

export interface AIProvider {
  name: string;
  type: 'generation' | 'embedding' | 'both';

  generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  generateEmbedding(text: string): Promise<EmbeddingResult>;

  estimateCost(inputTokens: number, outputTokens?: number): number;
  isAvailable(): Promise<boolean>;
  testConnection(): Promise<{ success: boolean; error?: string }>;
}

export type ProviderType = 'gemini' | 'claude' | 'openai' | 'xai' | 'custom';

export interface CustomAPIModel {
  id: string;          // Internal unique ID
  name: string;        // Display name in settings
  modelId: string;     // The actual model ID expected by the API (e.g., "llama3" or "anthropic/claude-3-haiku")
  baseUrl: string;     // The endpoint URL (e.g., "http://localhost:1234/v1" or "https://openrouter.ai/api/v1")
  apiKey: string;      // API key
  type: 'generation' | 'embedding' | 'both';
}

export interface SavedPrompt {
  id: string;
  name: string;
  description?: string;
  prompt: string;
}

export interface SourceItem {
  id: string;
  type: 'obsidian-note' | 'manual-input';
  title: string;
  content: string;
  metadata: {
    charCount: number;
    wordCount: number;
    filePath?: string;
    tags?: string[];
  };
  addedAt: string;
}

export type MultiSourceAnalysisType = 'synthesis' | 'basic' | 'summary' | 'custom';

export type InsertionMode = 'new-note' | 'cursor' | 'end-of-note';

// ============================================
// Note & Analysis Types
// ============================================

export interface NoteMetadata {
  id: number;
  path: string;
  title: string;
  contentHash: string;
  wordCount: number;
  createdAt: Date;
  modifiedAt: Date;
  embeddingId?: number;
  lastAnalyzedAt?: Date;
}

export interface NoteEmbedding {
  noteId: number;
  embedding: number[];
  model: string;
  createdAt: Date;
}

export type RelationType = 'extends' | 'supports' | 'contradicts' | 'examples' | 'related';
export type GapPriority = 'high' | 'medium' | 'low';

export interface NoteConnection {
  id: number;
  sourceNoteId: number;
  targetNoteId: number;
  relationType: RelationType;
  confidence: number;  // 0-1
  reasoning?: string;
  createdAt: Date;
}

export interface KnowledgeGap {
  id: number;
  noteId: number;
  topic: string;
  description?: string;
  priority: GapPriority;
  suggestedResources?: string[];
  createdAt: Date;
}

export interface AnalysisResult {
  noteId: number;
  connections: {
    targetPath: string;
    relationType: RelationType;
    confidence: number;
    reasoning: string;
  }[];
  gaps: {
    topic: string;
    description: string;
    priority: GapPriority;
    suggestedResources?: string[];
  }[];
  insights: string;
  cost: number;
  timestamp: Date;
}

// ============================================
// YAML Frontmatter Schema
// ============================================

export interface OSBAFrontmatter {
  version: number;
  lastAnalyzed?: string;  // ISO8601
  embeddingId?: string;
  confidenceScore?: number;  // 0-1
  related?: {
    path: string;
    score: number;
    relation: RelationType;
  }[];
  gaps?: {
    topic: string;
    priority: GapPriority;
  }[];
  clusters?: string[];
  // Similar notes found via embedding search
  similarNotes?: {
    path: string;
    title: string;
    similarity: number;
  }[];
  similarNotesUpdated?: string;  // ISO8601
}

// ============================================
// Job Queue Types
// ============================================

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobType = 'quick-draft' | 'analyze' | 'embed' | 'batch-embed' | 'vault-scan';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;  // 0-100
  data: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedCost?: number;
  actualCost?: number;
}

export interface JobQueueEvents {
  'job:created': (job: Job) => void;
  'job:started': (job: Job) => void;
  'job:progress': (job: Job, progress: number) => void;
  'job:completed': (job: Job) => void;
  'job:failed': (job: Job, error: Error) => void;
  'job:cancelled': (job: Job) => void;
}

// ============================================
// Cost Tracking Types
// ============================================

export interface UsageRecord {
  id: number;
  timestamp: Date;
  provider: ProviderType;
  model: string;
  operation: 'generation' | 'embedding' | 'analysis' | 'draft' | 'indexing';
  inputTokens: number;
  outputTokens: number;
  cost: number;
  jobId?: string;
  notePath?: string;
}

export interface UsageSummary {
  period: 'day' | 'week' | 'month' | 'all';
  startDate: Date;
  endDate: Date;
  totalCost: number;
  totalRequests: number;
  totalTokens: number;
  byProvider: Record<ProviderType, number>;
  byModel: Record<string, number>;
  byOperation: Record<string, number>;
  requestCount: number;
}

// Alias for backward compatibility
export type UsageLog = UsageRecord;

// Job Status Info for UI display (different from JobStatus string type)
export interface JobStatusInfo {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  notePath?: string;
  error?: string;
  createdAt: Date;
}

// ============================================
// Search & RAG Types
// ============================================

export interface SearchResult {
  notePath: string;
  title: string;
  similarity: number;
  snippet?: string;
}

export interface RAGContext {
  notes: {
    path: string;
    title: string;
    content: string;
    similarity: number;
  }[];
  totalTokens: number;
  truncated: boolean;
}

// ============================================
// Error Types
// ============================================

export class OSBAError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OSBAError';
  }
}

export class APIError extends OSBAError {
  constructor(
    message: string,
    public provider: ProviderType,
    public statusCode?: number,
    recoverable: boolean = true
  ) {
    super(message, 'API_ERROR', recoverable, { provider, statusCode });
    this.name = 'APIError';
  }
}

export class BudgetExceededError extends OSBAError {
  constructor(
    public currentSpend: number,
    public limit: number,
    public period: 'daily' | 'monthly'
  ) {
    super(
      `${period} budget exceeded: $${currentSpend.toFixed(2)} / $${limit.toFixed(2)}`,
      'BUDGET_EXCEEDED',
      false,
      { currentSpend, limit, period }
    );
    this.name = 'BudgetExceededError';
  }
}

export class RateLimitError extends APIError {
  constructor(
    provider: ProviderType,
    public retryAfter?: number
  ) {
    super('Rate limit exceeded', provider, 429, true);
    this.name = 'RateLimitError';
  }
}
