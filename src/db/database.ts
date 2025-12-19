import BetterSqlite3, { Database as SqliteDatabase } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as crypto from 'crypto';
import {
  NoteMetadata,
  NoteConnection,
  KnowledgeGap,
  UsageRecord,
  UsageSummary,
  RelationType,
  GapPriority,
  ProviderType,
  SearchResult,
} from '../types';

// ============================================
// Database Schema
// ============================================

const SCHEMA = `
-- Notes metadata table
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  title TEXT,
  content_hash TEXT,
  word_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  embedding_id INTEGER,
  last_analyzed_at DATETIME,
  FOREIGN KEY (embedding_id) REFERENCES note_embeddings(id)
);

CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
CREATE INDEX IF NOT EXISTS idx_notes_content_hash ON notes(content_hash);

-- Note embeddings table (using sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS note_embeddings USING vec0(
  id INTEGER PRIMARY KEY,
  embedding FLOAT[1536]
);

-- Connections between notes
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_note_id INTEGER NOT NULL,
  target_note_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('extends', 'supports', 'contradicts', 'examples', 'related')),
  confidence REAL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
  reasoning TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  UNIQUE(source_note_id, target_note_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_note_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_note_id);

-- Knowledge gaps identified
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
  suggested_resources TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gaps_note ON knowledge_gaps(note_id);
CREATE INDEX IF NOT EXISTS idx_gaps_priority ON knowledge_gaps(priority);

-- API usage logging
CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  provider TEXT NOT NULL CHECK(provider IN ('gemini', 'claude', 'openai')),
  model TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('generation', 'embedding')),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  job_id TEXT,
  note_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_log(provider);

-- Response cache for cost optimization
CREATE TABLE IF NOT EXISTS response_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT UNIQUE NOT NULL,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  hit_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cache_key ON response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON response_cache(expires_at);

-- Embedding cache for avoiding redundant API calls
CREATE TABLE IF NOT EXISTS embedding_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT UNIQUE NOT NULL,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_embedding_hash ON embedding_cache(content_hash);

-- Job queue for async operations
CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0,
  data TEXT,
  result TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  estimated_cost REAL,
  actual_cost REAL
);

CREATE INDEX IF NOT EXISTS idx_job_status ON job_queue(status);
`;

// ============================================
// Database Class
// ============================================

export class OSBADatabase {
  private db!: SqliteDatabase;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      // Create database connection
      this.db = new BetterSqlite3(this.dbPath);

      // Load sqlite-vec extension
      sqliteVec.load(this.db);

      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');

      // Run schema
      this.db.exec(SCHEMA);

      console.log('OSBA Database initialized successfully');

    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }

  // ============================================
  // Notes Operations
  // ============================================

  async upsertNote(
    path: string,
    title: string,
    content: string
  ): Promise<number> {
    const contentHash = this.hashContent(content);
    const wordCount = content.split(/\s+/).length;

    const stmt = this.db.prepare(`
      INSERT INTO notes (path, title, content_hash, word_count, modified_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        content_hash = excluded.content_hash,
        word_count = excluded.word_count,
        modified_at = CURRENT_TIMESTAMP
      RETURNING id
    `);

    const result = stmt.get(path, title, contentHash, wordCount) as { id: number };
    return result.id;
  }

  async getNoteByPath(path: string): Promise<NoteMetadata | null> {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE path = ?');
    const row = stmt.get(path) as any;

    if (!row) return null;

    return this.mapNoteRow(row);
  }

  async getNoteById(id: number): Promise<NoteMetadata | null> {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.mapNoteRow(row);
  }

  async deleteNote(path: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM notes WHERE path = ?');
    stmt.run(path);
  }

  async updateNotePath(oldPath: string, newPath: string): Promise<void> {
    const stmt = this.db.prepare('UPDATE notes SET path = ? WHERE path = ?');
    stmt.run(newPath, oldPath);
  }

  async hasContentChanged(path: string, content: string): Promise<boolean> {
    const newHash = this.hashContent(content);
    const stmt = this.db.prepare('SELECT content_hash FROM notes WHERE path = ?');
    const row = stmt.get(path) as { content_hash: string } | undefined;

    return !row || row.content_hash !== newHash;
  }

  private mapNoteRow(row: any): NoteMetadata {
    return {
      id: row.id,
      path: row.path,
      title: row.title,
      contentHash: row.content_hash,
      wordCount: row.word_count,
      createdAt: new Date(row.created_at),
      modifiedAt: new Date(row.modified_at),
      embeddingId: row.embedding_id,
      lastAnalyzedAt: row.last_analyzed_at ? new Date(row.last_analyzed_at) : undefined,
    };
  }

  // ============================================
  // Embedding Operations
  // ============================================

  async storeEmbedding(noteId: number, embedding: number[]): Promise<number> {
    // Store in vec0 virtual table
    const stmt = this.db.prepare(`
      INSERT INTO note_embeddings (id, embedding)
      VALUES (?, vec_f32(?))
      ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding
    `);

    stmt.run(noteId, new Float32Array(embedding));

    // Update note with embedding reference
    const updateStmt = this.db.prepare(`
      UPDATE notes SET embedding_id = ? WHERE id = ?
    `);
    updateStmt.run(noteId, noteId);

    return noteId;
  }

  async findSimilar(
    embedding: number[],
    limit: number = 10,
    excludeNoteId?: number
  ): Promise<SearchResult[]> {
    let query = `
      SELECT
        n.path,
        n.title,
        vec_distance_cosine(e.embedding, vec_f32(?)) as distance
      FROM note_embeddings e
      JOIN notes n ON e.id = n.id
    `;

    const params: any[] = [new Float32Array(embedding)];

    if (excludeNoteId) {
      query += ' WHERE n.id != ?';
      params.push(excludeNoteId);
    }

    query += ' ORDER BY distance ASC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      notePath: row.path,
      title: row.title,
      similarity: 1 - row.distance, // Convert distance to similarity
    }));
  }

  async getCachedEmbedding(contentHash: string): Promise<number[] | null> {
    const stmt = this.db.prepare(`
      SELECT embedding FROM embedding_cache WHERE content_hash = ?
    `);
    const row = stmt.get(contentHash) as { embedding: Buffer } | undefined;

    if (!row) return null;

    // Convert blob back to array
    const buffer = row.embedding;
    const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    return Array.from(floatArray);
  }

  async cacheEmbedding(contentHash: string, embedding: number[], model: string): Promise<void> {
    const buffer = Buffer.from(new Float32Array(embedding).buffer);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, model)
      VALUES (?, ?, ?)
    `);

    stmt.run(contentHash, buffer, model);
  }

  // ============================================
  // Connection Operations
  // ============================================

  async storeConnections(
    sourceNoteId: number,
    connections: {
      targetNoteId: number;
      relationType: RelationType;
      confidence: number;
      reasoning: string;
    }[]
  ): Promise<void> {
    // Clear existing connections for this source
    const deleteStmt = this.db.prepare('DELETE FROM connections WHERE source_note_id = ?');
    deleteStmt.run(sourceNoteId);

    // Insert new connections
    const insertStmt = this.db.prepare(`
      INSERT INTO connections (source_note_id, target_note_id, relation_type, confidence, reasoning)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((conns: typeof connections) => {
      for (const conn of conns) {
        insertStmt.run(
          sourceNoteId,
          conn.targetNoteId,
          conn.relationType,
          conn.confidence,
          conn.reasoning
        );
      }
    });

    insertMany(connections);
  }

  async getConnectionsForNote(noteId: number): Promise<NoteConnection[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM connections
      WHERE source_note_id = ? OR target_note_id = ?
      ORDER BY confidence DESC
    `);

    const rows = stmt.all(noteId, noteId) as any[];

    return rows.map(row => ({
      id: row.id,
      sourceNoteId: row.source_note_id,
      targetNoteId: row.target_note_id,
      relationType: row.relation_type as RelationType,
      confidence: row.confidence,
      reasoning: row.reasoning,
      createdAt: new Date(row.created_at),
    }));
  }

  // ============================================
  // Knowledge Gap Operations
  // ============================================

  async storeGaps(
    noteId: number,
    gaps: {
      topic: string;
      description: string;
      priority: GapPriority;
      suggestedResources?: string[];
    }[]
  ): Promise<void> {
    // Clear existing gaps for this note
    const deleteStmt = this.db.prepare('DELETE FROM knowledge_gaps WHERE note_id = ?');
    deleteStmt.run(noteId);

    // Insert new gaps
    const insertStmt = this.db.prepare(`
      INSERT INTO knowledge_gaps (note_id, topic, description, priority, suggested_resources)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((gapList: typeof gaps) => {
      for (const gap of gapList) {
        insertStmt.run(
          noteId,
          gap.topic,
          gap.description,
          gap.priority,
          gap.suggestedResources ? JSON.stringify(gap.suggestedResources) : null
        );
      }
    });

    insertMany(gaps);
  }

  async getGapsForNote(noteId: number): Promise<KnowledgeGap[]> {
    const stmt = this.db.prepare('SELECT * FROM knowledge_gaps WHERE note_id = ?');
    const rows = stmt.all(noteId) as any[];

    return rows.map(row => ({
      id: row.id,
      noteId: row.note_id,
      topic: row.topic,
      description: row.description,
      priority: row.priority as GapPriority,
      suggestedResources: row.suggested_resources ? JSON.parse(row.suggested_resources) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  async getAllGapsByPriority(priority?: GapPriority): Promise<KnowledgeGap[]> {
    let query = 'SELECT * FROM knowledge_gaps';
    const params: any[] = [];

    if (priority) {
      query += ' WHERE priority = ?';
      params.push(priority);
    }

    query += ' ORDER BY priority DESC, created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      noteId: row.note_id,
      topic: row.topic,
      description: row.description,
      priority: row.priority as GapPriority,
      suggestedResources: row.suggested_resources ? JSON.parse(row.suggested_resources) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  // ============================================
  // Usage Logging Operations
  // ============================================

  async logUsage(usage: Omit<UsageRecord, 'id' | 'timestamp'>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO usage_log (provider, model, operation, input_tokens, output_tokens, cost, job_id, note_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      usage.provider,
      usage.model,
      usage.operation,
      usage.inputTokens,
      usage.outputTokens,
      usage.cost,
      usage.jobId || null,
      usage.notePath || null
    );
  }

  async getUsageSummary(period: 'day' | 'week' | 'month' | 'all'): Promise<UsageSummary> {
    let startDate: Date;
    const endDate = new Date();
    const isAllTime = period === 'all';

    switch (period) {
      case 'day':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
    }

    const startDateStr = startDate.toISOString();
    const whereClause = isAllTime ? '' : 'WHERE timestamp >= ?';

    // Total cost and tokens
    const totalStmt = this.db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total,
             COUNT(*) as count,
             COALESCE(SUM(input_tokens + output_tokens), 0) as tokens
      FROM usage_log ${whereClause}
    `);
    const totalRow = (isAllTime ? totalStmt.get() : totalStmt.get(startDateStr)) as { total: number; count: number; tokens: number };

    // By provider
    const providerStmt = this.db.prepare(`
      SELECT provider, COALESCE(SUM(cost), 0) as cost
      FROM usage_log ${whereClause}
      GROUP BY provider
    `);
    const providerRows = (isAllTime ? providerStmt.all() : providerStmt.all(startDateStr)) as { provider: ProviderType; cost: number }[];

    // By model
    const modelStmt = this.db.prepare(`
      SELECT model, COALESCE(SUM(cost), 0) as cost
      FROM usage_log ${whereClause}
      GROUP BY model
    `);
    const modelRows = (isAllTime ? modelStmt.all() : modelStmt.all(startDateStr)) as { model: string; cost: number }[];

    // By operation
    const opStmt = this.db.prepare(`
      SELECT operation, COALESCE(SUM(cost), 0) as cost
      FROM usage_log ${whereClause}
      GROUP BY operation
    `);
    const opRows = (isAllTime ? opStmt.all() : opStmt.all(startDateStr)) as { operation: string; cost: number }[];

    return {
      period,
      startDate,
      endDate,
      totalCost: totalRow.total,
      totalRequests: totalRow.count,
      totalTokens: totalRow.tokens,
      byProvider: Object.fromEntries(providerRows.map(r => [r.provider, r.cost])) as Record<ProviderType, number>,
      byModel: Object.fromEntries(modelRows.map(r => [r.model, r.cost])),
      byOperation: Object.fromEntries(opRows.map(r => [r.operation, r.cost])),
      requestCount: totalRow.count,
    };
  }

  async getTodaysCost(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total
      FROM usage_log WHERE timestamp >= ?
    `);
    const row = stmt.get(today.toISOString()) as { total: number };

    return row.total;
  }

  async getMonthsCost(): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total
      FROM usage_log WHERE timestamp >= ?
    `);
    const row = stmt.get(startOfMonth.toISOString()) as { total: number };

    return row.total;
  }

  // ============================================
  // Cache Operations
  // ============================================

  async getCachedResponse(cacheKey: string): Promise<string | null> {
    const stmt = this.db.prepare(`
      SELECT response FROM response_cache
      WHERE cache_key = ? AND expires_at > CURRENT_TIMESTAMP
    `);
    const row = stmt.get(cacheKey) as { response: string } | undefined;

    if (row) {
      // Update hit count
      const updateStmt = this.db.prepare(`
        UPDATE response_cache SET hit_count = hit_count + 1 WHERE cache_key = ?
      `);
      updateStmt.run(cacheKey);
    }

    return row?.response || null;
  }

  async cacheResponse(cacheKey: string, response: string, model: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO response_cache (cache_key, response, model, expires_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(cacheKey, response, model, expiresAt.toISOString());
  }

  async cleanExpiredCache(): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM response_cache WHERE expires_at <= CURRENT_TIMESTAMP
    `);
    const result = stmt.run();
    return result.changes;
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(): Promise<{
    totalNotes: number;
    indexedNotes: number;
    totalConnections: number;
    totalGaps: number;
    cacheHitRate: number;
    lastUpdated: Date | null;
  }> {
    const notesStmt = this.db.prepare('SELECT COUNT(*) as count FROM notes');
    const indexedStmt = this.db.prepare('SELECT COUNT(*) as count FROM notes WHERE embedding_id IS NOT NULL');
    const connectionsStmt = this.db.prepare('SELECT COUNT(*) as count FROM connections');
    const gapsStmt = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_gaps');
    const cacheStmt = this.db.prepare('SELECT SUM(hit_count) as hits, COUNT(*) as total FROM response_cache');
    const lastUpdatedStmt = this.db.prepare('SELECT MAX(modified_at) as last_updated FROM notes');

    const notes = (notesStmt.get() as { count: number }).count;
    const indexed = (indexedStmt.get() as { count: number }).count;
    const connections = (connectionsStmt.get() as { count: number }).count;
    const gaps = (gapsStmt.get() as { count: number }).count;
    const cache = cacheStmt.get() as { hits: number; total: number };
    const lastUpdatedRow = lastUpdatedStmt.get() as { last_updated: string | null };

    return {
      totalNotes: notes,
      indexedNotes: indexed,
      totalConnections: connections,
      totalGaps: gaps,
      cacheHitRate: cache.total > 0 ? (cache.hits || 0) / cache.total : 0,
      lastUpdated: lastUpdatedRow.last_updated ? new Date(lastUpdatedRow.last_updated) : null,
    };
  }

  // ============================================
  // Analysis Support Methods (for analyzer.ts)
  // ============================================

  async updateAnalysisTime(noteId: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE notes SET last_analyzed_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(noteId);
  }

  async upsertConnection(connection: {
    sourceNoteId: number;
    targetNoteId: number;
    relationType: RelationType;
    confidence: number;
    reasoning: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO connections (source_note_id, target_note_id, relation_type, confidence, reasoning)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_note_id, target_note_id, relation_type) DO UPDATE SET
        confidence = excluded.confidence,
        reasoning = excluded.reasoning
    `);

    stmt.run(
      connection.sourceNoteId,
      connection.targetNoteId,
      connection.relationType,
      connection.confidence,
      connection.reasoning
    );
  }

  async upsertKnowledgeGap(gap: {
    noteId: number;
    topic: string;
    description: string;
    priority: GapPriority;
    suggestedResources?: string[];
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_gaps (note_id, topic, description, priority, suggested_resources)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      gap.noteId,
      gap.topic,
      gap.description,
      gap.priority,
      gap.suggestedResources ? JSON.stringify(gap.suggestedResources) : null
    );
  }

  async getAnalysisStats(): Promise<{
    totalConnections: number;
    totalGaps: number;
    analyzedNotes: number;
    pendingAnalysis: number;
  }> {
    const connectionsStmt = this.db.prepare('SELECT COUNT(*) as count FROM connections');
    const gapsStmt = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_gaps');
    const analyzedStmt = this.db.prepare('SELECT COUNT(*) as count FROM notes WHERE last_analyzed_at IS NOT NULL');
    const pendingStmt = this.db.prepare('SELECT COUNT(*) as count FROM notes WHERE last_analyzed_at IS NULL AND embedding_id IS NOT NULL');

    const connections = (connectionsStmt.get() as { count: number }).count;
    const gaps = (gapsStmt.get() as { count: number }).count;
    const analyzed = (analyzedStmt.get() as { count: number }).count;
    const pending = (pendingStmt.get() as { count: number }).count;

    return {
      totalConnections: connections,
      totalGaps: gaps,
      analyzedNotes: analyzed,
      pendingAnalysis: pending,
    };
  }

  async clearCache(): Promise<void> {
    this.db.prepare('DELETE FROM response_cache').run();
    this.db.prepare('DELETE FROM embedding_cache').run();
  }

  // ============================================
  // Utility Methods
  // ============================================

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
}

// Re-export with original name for backward compatibility
export { OSBADatabase as Database };
