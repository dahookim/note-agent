import { App, Plugin, PluginManifest, Notice, TFile, Events } from 'obsidian';
import { OSBASettings, DEFAULT_SETTINGS, Job, JobStatus, AnalysisResult } from './types';
import { OSBASettingTab } from './ui/settings';
import { Database } from './db/database';
import { AIProviderManager } from './api/provider';
import { EmbeddingService } from './core/embeddings';
import { ConnectionAnalyzer } from './core/analyzer';
import { FrontmatterManager } from './core/frontmatter';
import { QuickDraftModal, OSBAMainMenuModal } from './ui/modals';
import { ProgressModal } from './ui/progress-modal';
import {
  JobQueueView,
  JOB_QUEUE_VIEW_TYPE,
  CostDashboardView,
  COST_DASHBOARD_VIEW_TYPE,
  SimilarNotesView,
  SIMILAR_NOTES_VIEW_TYPE,
  KnowledgeGraphView,
  KNOWLEDGE_GRAPH_VIEW_TYPE
} from './ui/views';

/**
 * Note Agent Plugin
 *
 * Main plugin class that orchestrates all OSBA functionality:
 * - AI-powered note drafting
 * - Automatic embedding generation
 * - Connection analysis
 * - Knowledge gap detection
 */
export default class OSBAPlugin extends Plugin {
  settings!: OSBASettings;
  database!: Database;
  providerManager!: AIProviderManager;
  embeddingService!: EmbeddingService;
  connectionAnalyzer!: ConnectionAnalyzer;
  frontmatterManager!: FrontmatterManager;

  // Event emitter for internal communication
  events: Events = new Events();

  // Job queue state
  private jobQueue: Map<string, Job> = new Map();
  private isProcessingQueue: boolean = false;

  // Prevent auto-analysis on Obsidian startup
  private pluginReady: boolean = false;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload(): Promise<void> {
    console.log('Loading OSBA Plugin...');

    // Load settings
    await this.loadSettings();

    // Initialize core services
    await this.initializeServices();

    // Register views
    this.registerViews();

    // Register commands
    this.registerCommands();

    // Register event handlers
    this.registerEventHandlers();

    // Add settings tab
    this.addSettingTab(new OSBASettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon('brain-circuit', 'OSBA: Quick Actions', () => {
      new OSBAMainMenuModal(this.app, this).open();
    });

    // Delay plugin ready flag to prevent auto-analysis on startup
    // The 'create' event fires for existing notes during Obsidian startup
    setTimeout(() => {
      this.pluginReady = true;
    }, 5000);

    console.log('OSBA Plugin loaded successfully');
    new Notice('Note Agent loaded');
  }

  async onunload(): Promise<void> {
    console.log('Unloading OSBA Plugin...');

    // Cancel any running jobs
    for (const [id, job] of this.jobQueue) {
      if (job.status === 'running' || job.status === 'pending') {
        await this.cancelJob(id);
      }
    }

    // Close database connection
    if (this.database) {
      await this.database.close();
    }

    console.log('OSBA Plugin unloaded');
  }

  // ============================================
  // Initialization
  // ============================================

  private async initializeServices(): Promise<void> {
    try {
      // Initialize database with Obsidian file adapter
      const dbPath = `${this.app.vault.configDir}/plugins/note-agent/osba.db`;
      this.database = new Database(dbPath);

      // Set up persistence callbacks for sql.js database
      const adapter = this.app.vault.adapter;

      this.database.setSaveCallback(async (data: Uint8Array) => {
        try {
          // Ensure directory exists
          const dirPath = `${this.app.vault.configDir}/plugins/note-agent`;
          if (!(await adapter.exists(dirPath))) {
            await adapter.mkdir(dirPath);
          }
          // Convert Uint8Array to ArrayBuffer for Obsidian's adapter
          const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          await adapter.writeBinary(dbPath, buffer);
        } catch (error) {
          console.error('Failed to save database:', error);
        }
      });

      this.database.setLoadCallback(async () => {
        try {
          if (await adapter.exists(dbPath)) {
            const data = await adapter.readBinary(dbPath);
            return new Uint8Array(data);
          }
        } catch (error) {
          console.log('No existing database found, will create new one');
        }
        return null;
      });

      await this.database.initialize();

      // Initialize AI provider manager
      this.providerManager = new AIProviderManager(this.settings);

      // Initialize embedding service
      this.embeddingService = new EmbeddingService(
        this.app.vault,
        this.app.metadataCache,
        this.database,
        this.providerManager,
        this.settings
      );

      // Initialize connection analyzer
      this.connectionAnalyzer = new ConnectionAnalyzer(
        this.app.vault,
        this.database,
        this.providerManager,
        this.embeddingService,
        this.settings
      );

      // Initialize frontmatter manager
      this.frontmatterManager = new FrontmatterManager(this.app);

    } catch (error) {
      console.error('Failed to initialize OSBA services:', error);
      new Notice('OSBA: Failed to initialize. Check console for details.');
      throw error;
    }
  }

  // ============================================
  // View Registration
  // ============================================

  private registerViews(): void {
    // Job Queue View
    this.registerView(
      JOB_QUEUE_VIEW_TYPE,
      (leaf) => new JobQueueView(leaf, this)
    );

    // Cost Dashboard View
    this.registerView(
      COST_DASHBOARD_VIEW_TYPE,
      (leaf) => new CostDashboardView(leaf, this)
    );

    // Similar Notes View
    this.registerView(
      SIMILAR_NOTES_VIEW_TYPE,
      (leaf) => new SimilarNotesView(leaf, this)
    );

    // Knowledge Graph View
    this.registerView(
      KNOWLEDGE_GRAPH_VIEW_TYPE,
      (leaf) => new KnowledgeGraphView(leaf, this)
    );
  }

  // ============================================
  // Command Registration
  // ============================================

  private registerCommands(): void {
    // Open OSBA Main Menu
    this.addCommand({
      id: 'open-main-menu',
      name: 'Open Main Menu - Quick Actions',
      callback: () => {
        new OSBAMainMenuModal(this.app, this).open();
      },
    });

    // Quick Draft command
    this.addCommand({
      id: 'quick-draft',
      name: 'Quick Draft - Create AI-powered note',
      callback: () => {
        new QuickDraftModal(this.app, this).open();
      },
    });

    // Analyze current note
    this.addCommand({
      id: 'analyze-note',
      name: 'Analyze Connections - Find related notes',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          if (!checking) {
            this.analyzeNote(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Generate embedding for current note
    this.addCommand({
      id: 'generate-embedding',
      name: 'Generate Embedding - Index current note',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          if (!checking) {
            this.generateEmbedding(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    // Batch index all notes
    this.addCommand({
      id: 'batch-index',
      name: 'Batch Index - Index all notes in vault',
      callback: () => {
        this.batchIndexVault();
      },
    });

    // Open Job Queue
    this.addCommand({
      id: 'open-job-queue',
      name: 'Open Job Queue',
      callback: () => {
        this.activateView(JOB_QUEUE_VIEW_TYPE);
      },
    });

    // Open Cost Dashboard
    this.addCommand({
      id: 'open-cost-dashboard',
      name: 'Open Cost Dashboard',
      callback: () => {
        this.activateView(COST_DASHBOARD_VIEW_TYPE);
      },
    });

    // Find similar notes
    this.addCommand({
      id: 'find-similar',
      name: 'Find Similar Notes',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md') {
          if (!checking) {
            this.findSimilarNotes(activeFile);
          }
          return true;
        }
        return false;
      },
    });
  }

  // ============================================
  // Event Handlers
  // ============================================

  private registerEventHandlers(): void {
    // Handle file creation
    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        // Ignore events during Obsidian startup to prevent auto-analysis of existing notes
        if (!this.pluginReady) {
          return;
        }

        if (file instanceof TFile && file.extension === 'md') {
          if (this.settings.autoEmbedOnModify) {
            await this.generateEmbedding(file);
          }
          if (this.settings.autoAnalyzeOnCreate) {
            // Delay analysis to allow content to be written
            // Pass false to suppress notifications for auto-triggered analysis
            setTimeout(() => this.analyzeNote(file, false), 2000);
          }
        }
      })
    );

    // Handle file modification
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          if (this.settings.autoEmbedOnModify) {
            // Debounce embedding updates
            this.debounceEmbedding(file);
          }
        }
      })
    );

    // Handle file deletion
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.database.deleteNote(file.path);
        }
      })
    );

    // Handle file rename
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.database.updateNotePath(oldPath, file.path);
        }
      })
    );
  }

  // Debounce map for embedding updates
  private embeddingDebounceMap: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private debounceEmbedding(file: TFile): void {
    const existing = this.embeddingDebounceMap.get(file.path);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      this.embeddingDebounceMap.delete(file.path);
      await this.generateEmbedding(file);
    }, 5000); // 5 second debounce

    this.embeddingDebounceMap.set(file.path, timeout);
  }

  // ============================================
  // Core Operations
  // ============================================

  async generateQuickDraft(prompt: string, insertInCurrentNote: boolean): Promise<string> {
    const job = this.createJob('quick-draft', { prompt, insertInCurrentNote });

    try {
      this.updateJobStatus(job.id, 'running');

      // Get current note context if available
      const activeFile = this.app.workspace.getActiveFile();
      let context = '';

      if (activeFile && activeFile.extension === 'md') {
        context = await this.app.vault.read(activeFile);

        // Get related notes via RAG
        const relatedNotes = await this.embeddingService.searchByQuery(context, 5);
        for (const note of relatedNotes) {
          const file = this.app.vault.getAbstractFileByPath(note.notePath);
          if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            context += `\n\n---\nRelated Note: ${note.title}\n${content.slice(0, 2000)}`;
          }
        }
      }

      this.updateJobProgress(job.id, 30);

      // Generate draft using AI
      const result = await this.providerManager.generateText(
        this.settings.quickDraftModel,
        this.buildQuickDraftPrompt(prompt, context)
      );

      this.updateJobProgress(job.id, 80);

      // Log cost - determine provider from model result
      let provider: 'gemini' | 'claude' | 'openai' | 'xai' = 'gemini';
      if (result.model.includes('claude')) {
        provider = 'claude';
      } else if (result.model.includes('gpt')) {
        provider = 'openai';
      } else if (result.model.includes('grok')) {
        provider = 'xai';
      }

      await this.database.logUsage({
        provider,
        model: result.model,
        operation: 'draft',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
        jobId: job.id,
      });

      // Handle output
      if (insertInCurrentNote && activeFile) {
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) {
          editor.replaceSelection(result.text);
        }
      } else {
        // Create new note
        const fileName = `Draft - ${new Date().toISOString().slice(0, 10)}.md`;
        await this.app.vault.create(fileName, result.text);
        new Notice(`Created: ${fileName}`);
      }

      this.updateJobStatus(job.id, 'completed', result);
      return result.text;

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      throw error;
    }
  }

  private buildQuickDraftPrompt(userPrompt: string, context: string): string {
    return `You are an expert knowledge management assistant. Generate a well-structured markdown note based on the user's request.

${context ? `## Context from existing notes:\n${context}\n\n` : ''}

## User Request:
${userPrompt}

## Guidelines:
- Use proper markdown formatting
- Include relevant headers and sections
- Be comprehensive but concise
- Include potential connections to other topics
- Suggest areas for further exploration

## Output:
Generate the markdown content for the note:`;
  }

  async generateEmbedding(file: TFile): Promise<void> {
    try {
      // Check if excluded
      if (this.isExcluded(file)) {
        return;
      }

      await this.embeddingService.processNote(file);

    } catch (error) {
      console.error(`Failed to generate embedding for ${file.path}:`, error);
    }
  }

  async analyzeNote(file: TFile, showFeedback: boolean = true): Promise<void> {
    // Check exclusion BEFORE opening modal to prevent unnecessary UI
    if (this.isExcluded(file)) {
      if (showFeedback) {
        new Notice('이 노트는 분석에서 제외되었습니다.');
      }
      console.log(`Note excluded from analysis: ${file.path}`);
      return;
    }

    const job = this.createJob('analyze', { path: file.path });
    const modal = new ProgressModal(this.app, '노트 분석');
    modal.open();
    modal.updateState({ message: '분석 준비 중...' });

    try {
      this.updateJobStatus(job.id, 'running');

      modal.updateProgress(30, '관련 노트 찾는 중...');

      // Actual analysis logic here logic is inside connectionAnalyzer.analyzeNote
      // But since analyzeNote is atomic in the current implementation, we can just await it
      // For better progress updates, we'd need to modify connectionAnalyzer to accept a progress callback
      // For now, we simulate progress steps 

      modal.updateProgress(50, 'AI 분석 실행 중...');
      const result = await this.connectionAnalyzer.analyzeNote(file);

      modal.updateProgress(80, '결과 저장 중...');

      // Update note frontmatter
      await this.updateNoteFrontmatter(file, result);

      // Add Connected Insights section
      await this.addInsightsSection(file, result);

      this.updateJobStatus(job.id, 'completed', result);

      modal.complete(`✅ ${result.connections.length}개의 연결 발견!`);
      setTimeout(() => modal.close(), 1500);

      new Notice(`Analysis complete: Found ${result.connections.length} connections`);

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      modal.setError(error instanceof Error ? error.message : 'Analysis failed');
      new Notice('Analysis failed. Check console for details.');
    }
  }

  async findSimilarNotes(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      const similar = await this.embeddingService.searchByQuery(content, 10);

      const similarForSection = similar.map(n => ({
        title: n.title,
        path: n.notePath,
        similarity: n.similarity
      }));

      // Update frontmatter (version + date only)
      await this.frontmatterManager.updateSimilarNotes(file, similarForSection);

      // Get the new version from frontmatter
      const osba = await this.frontmatterManager.getOSBAFrontmatter(file);
      const version = osba?.similarNotesVersion || 1;

      // Append/update results section at the bottom of note body
      await this.frontmatterManager.addSimilarNotesSection(file, similarForSection, version);

      // Display results in a modal or notice
      if (similar.length === 0) {
        new Notice('No similar notes found. Try indexing your vault first.');
      } else {
        new Notice(`유사 노트 ${similar.length}개를 노트 하단에 저장했습니다. (v${version})`, 3000);
      }

    } catch (error) {
      console.error('Failed to find similar notes:', error);
      new Notice('Failed to find similar notes');
    }
  }

  async batchIndexVault(): Promise<void> {
    const job = this.createJob('batch-embed', {});
    const modal = new ProgressModal(this.app, '전체 인덱싱');
    modal.open();
    modal.updateState({ message: '인덱싱 준비 중...', progress: 0 });

    try {
      this.updateJobStatus(job.id, 'running');

      const files = this.app.vault.getMarkdownFiles()
        .filter(f => !this.isExcluded(f));

      let processed = 0;
      const total = files.length;

      modal.updateState({
        message: `총 ${total}개 노트 인덱싱 시작`,
        subMessage: '잠시만 기다려주세요...'
      });

      for (const file of files) {
        // Update progress modal
        modal.updateProgress(
          (processed / total) * 100,
          `${processed}/${total} 처리 중`
        );
        modal.updateState({ subMessage: file.basename });

        // Generate embedding
        await this.generateEmbedding(file);

        processed++;
        this.updateJobProgress(job.id, Math.round((processed / total) * 100));
      }

      this.updateJobStatus(job.id, 'completed', { processed });
      modal.complete(`✅ ${processed}개 노트 인덱싱 완료!`);

      // Close modal after 2 seconds
      setTimeout(() => modal.close(), 2000);
      new Notice(`Indexed ${processed} notes`);

    } catch (error) {
      this.updateJobStatus(job.id, 'failed', undefined, error as Error);
      modal.setError(error instanceof Error ? error.message : 'Batch indexing failed');
      new Notice('Batch indexing failed');
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  public isExcluded(file: TFile): boolean {
    // Check file size first (applies to both modes)
    if (file.stat.size > this.settings.maxNoteSize) {
      console.log(`[OSBA] Note excluded - File size (${(file.stat.size / 1024).toFixed(1)}KB) exceeds maxNoteSize (${(this.settings.maxNoteSize / 1024).toFixed(1)}KB): ${file.path}`);
      return true;
    }

    // Check indexing mode
    if (this.settings.indexingMode === 'include') {
      // Include mode: only index files in includedFolders
      if (this.settings.includedFolders.length === 0) {
        // No folders specified, include nothing (exclude all)
        console.log(`[OSBA] Note excluded - Include mode active but no folders specified: ${file.path}`);
        return true;
      }

      // Check if file is in any included folder
      const isIncluded = this.settings.includedFolders.some(folder =>
        file.path.startsWith(folder + '/') || file.path === folder
      );

      // If not in included folders, exclude it
      if (!isIncluded) {
        console.log(`[OSBA] Note excluded - Not in includedFolders [${this.settings.includedFolders.join(', ')}]: ${file.path}`);
        return true;
      }
    } else {
      // Exclude mode (default): exclude files in excludedFolders
      for (const folder of this.settings.excludedFolders) {
        if (file.path.startsWith(folder + '/')) {
          console.log(`[OSBA] Note excluded - In excludedFolders [${folder}]: ${file.path}`);
          return true;
        }
      }
    }

    return false;
  }

  private async updateNoteFrontmatter(file: TFile, result: AnalysisResult): Promise<void> {
    await this.frontmatterManager.updateNoteFrontmatter(file, result);
  }

  private async addInsightsSection(file: TFile, result: AnalysisResult): Promise<void> {
    await this.frontmatterManager.addInsightsSection(file, result);
  }

  // ============================================
  // Job Queue Management
  // ============================================

  private createJob(type: Job['type'], data: Record<string, unknown>): Job {
    const job: Job = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      status: 'pending',
      progress: 0,
      data,
      createdAt: new Date(),
    };

    this.jobQueue.set(job.id, job);
    this.events.trigger('job:created', job);

    return job;
  }

  private updateJobStatus(
    id: string,
    status: JobStatus,
    result?: unknown,
    error?: Error
  ): void {
    const job = this.jobQueue.get(id);
    if (!job) return;

    job.status = status;
    if (status === 'running') {
      job.startedAt = new Date();
    }
    if (status === 'completed' || status === 'failed') {
      job.completedAt = new Date();
    }
    if (result) {
      job.result = result;
    }
    if (error) {
      job.error = error.message;
    }

    this.events.trigger(`job:${status}`, job);
  }

  private updateJobProgress(id: string, progress: number): void {
    const job = this.jobQueue.get(id);
    if (!job) return;

    job.progress = progress;
    this.events.trigger('job:progress', job, progress);
  }

  async cancelJob(id: string): Promise<void> {
    const job = this.jobQueue.get(id);
    if (!job) return;

    job.status = 'cancelled';
    job.completedAt = new Date();
    this.events.trigger('job:cancelled', job);
  }

  getJobs(): Job[] {
    return Array.from(this.jobQueue.values());
  }

  // ============================================
  // View Activation
  // ============================================

  async activateView(viewType: string): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(viewType)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: viewType, active: true });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  // ============================================
  // Settings Management
  // ============================================

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Reinitialize provider manager with new settings
    if (this.providerManager) {
      this.providerManager.updateSettings(this.settings);
    }
  }
}
