/**
 * Settings Tab
 * Obsidian 플러그인 설정 UI
 */

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type OSBAPlugin from '../main';
import { OSBASettings, DEFAULT_SETTINGS, ProviderType } from '../types';

export class OSBASettingTab extends PluginSettingTab {
  plugin: OSBAPlugin;

  constructor(app: App, plugin: OSBAPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h1', { text: 'Second Brain Agent 설정' });

    // ============================================
    // API Keys Section
    // ============================================

    containerEl.createEl('h2', { text: '🔑 API 키 설정' });

    new Setting(containerEl)
      .setName('Gemini API Key')
      .setDesc('Google AI Studio에서 발급받은 API 키')
      .addText(text => text
        .setPlaceholder('Enter Gemini API key')
        .setValue(this.plugin.settings.geminiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.geminiApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('gemini');
        }));

    new Setting(containerEl)
      .setName('Claude API Key')
      .setDesc('Anthropic Console에서 발급받은 API 키')
      .addText(text => text
        .setPlaceholder('Enter Claude API key')
        .setValue(this.plugin.settings.claudeApiKey)
        .onChange(async (value) => {
          this.plugin.settings.claudeApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('claude');
        }));

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('OpenAI Platform에서 발급받은 API 키 (임베딩용)')
      .addText(text => text
        .setPlaceholder('Enter OpenAI API key')
        .setValue(this.plugin.settings.openaiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.openaiApiKey = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('테스트')
        .onClick(async () => {
          await this.testConnection('openai');
        }));

    // ============================================
    // Model Selection Section
    // ============================================

    containerEl.createEl('h2', { text: '🤖 모델 선택' });

    new Setting(containerEl)
      .setName('Quick Draft 모델')
      .setDesc('빠른 초안 작성에 사용할 모델 (속도 우선)')
      .addDropdown(dropdown => dropdown
        .addOption('gemini-flash', 'Gemini 2.0 Flash ($0.075/1M)')
        .addOption('gemini-pro', 'Gemini 1.5 Pro ($1.25/1M)')
        .addOption('claude-sonnet', 'Claude 3.5 Sonnet ($3.00/1M)')
        .setValue(this.plugin.settings.quickDraftModel)
        .onChange(async (value) => {
          this.plugin.settings.quickDraftModel = value as 'gemini-flash' | 'gemini-pro' | 'claude-sonnet';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('분석 모델')
      .setDesc('노트 분석 및 연결 탐색에 사용할 모델 (품질 우선)')
      .addDropdown(dropdown => dropdown
        .addOption('claude-sonnet', 'Claude 3.5 Sonnet ($3.00/1M)')
        .addOption('claude-opus', 'Claude 3 Opus ($15.00/1M)')
        .addOption('gemini-pro', 'Gemini 1.5 Pro ($1.25/1M)')
        .setValue(this.plugin.settings.analysisModel)
        .onChange(async (value) => {
          this.plugin.settings.analysisModel = value as 'claude-sonnet' | 'claude-opus' | 'gemini-pro';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('임베딩 모델')
      .setDesc('벡터 임베딩 생성에 사용할 모델')
      .addDropdown(dropdown => dropdown
        .addOption('openai-small', 'text-embedding-3-small ($0.02/1M)')
        .addOption('openai-large', 'text-embedding-3-large ($0.13/1M)')
        .setValue(this.plugin.settings.embeddingModel)
        .onChange(async (value) => {
          this.plugin.settings.embeddingModel = value as 'openai-small' | 'openai-large';
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Budget Settings Section
    // ============================================

    containerEl.createEl('h2', { text: '💰 예산 관리' });

    new Setting(containerEl)
      .setName('일일 예산 한도 (USD)')
      .setDesc('하루 최대 API 사용 금액')
      .addText(text => text
        .setPlaceholder('1.00')
        .setValue(this.plugin.settings.dailyBudgetLimit.toString())
        .onChange(async (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.dailyBudgetLimit = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('월간 예산 한도 (USD)')
      .setDesc('한 달 최대 API 사용 금액')
      .addText(text => text
        .setPlaceholder('10.00')
        .setValue(this.plugin.settings.monthlyBudgetLimit.toString())
        .onChange(async (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.monthlyBudgetLimit = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('예산 알림 활성화')
      .setDesc('예산 임계치 도달 시 알림 표시')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableBudgetAlerts)
        .onChange(async (value) => {
          this.plugin.settings.enableBudgetAlerts = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('예산 알림 임계치 (%)')
      .setDesc('이 비율에 도달하면 경고 표시')
      .addSlider(slider => slider
        .setLimits(50, 95, 5)
        .setValue(this.plugin.settings.budgetAlertThreshold)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.budgetAlertThreshold = value;
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Processing Settings Section
    // ============================================

    containerEl.createEl('h2', { text: '⚙️ 처리 설정' });

    new Setting(containerEl)
      .setName('제외 폴더')
      .setDesc('임베딩 및 분석에서 제외할 폴더 (쉼표로 구분)')
      .addTextArea(text => text
        .setPlaceholder('templates, .obsidian, archive')
        .setValue(this.plugin.settings.excludedFolders.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value
            .split(',')
            .map(f => f.trim())
            .filter(f => f.length > 0);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('제외 태그')
      .setDesc('이 태그가 있는 노트는 처리에서 제외 (쉼표로 구분)')
      .addTextArea(text => text
        .setPlaceholder('private, draft, wip')
        .setValue(this.plugin.settings.excludedTags.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.excludedTags = value
            .split(',')
            .map(t => t.trim().replace('#', ''))
            .filter(t => t.length > 0);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('최대 노트 크기 (KB)')
      .setDesc('이 크기보다 큰 노트는 처리에서 제외')
      .addText(text => text
        .setPlaceholder('50')
        .setValue((this.plugin.settings.maxNoteSize / 1024).toString())
        .onChange(async (value) => {
          const parsed = parseInt(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.maxNoteSize = parsed * 1024;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('배치 처리 크기')
      .setDesc('한 번에 처리할 노트 수')
      .addSlider(slider => slider
        .setLimits(5, 50, 5)
        .setValue(this.plugin.settings.batchSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.batchSize = value;
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Feature Toggles Section
    // ============================================

    containerEl.createEl('h2', { text: '🎛️ 기능 토글' });

    new Setting(containerEl)
      .setName('노트 생성 시 자동 분석')
      .setDesc('새 노트 생성 시 자동으로 분석 실행')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoAnalyzeOnCreate)
        .onChange(async (value) => {
          this.plugin.settings.autoAnalyzeOnCreate = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('노트 수정 시 자동 임베딩')
      .setDesc('노트 수정 시 자동으로 임베딩 업데이트')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoEmbedOnModify)
        .onChange(async (value) => {
          this.plugin.settings.autoEmbedOnModify = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('비용 추적 활성화')
      .setDesc('API 사용량 및 비용 추적')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableCostTracking)
        .onChange(async (value) => {
          this.plugin.settings.enableCostTracking = value;
          await this.plugin.saveSettings();
        }));

    // ============================================
    // Advanced Section
    // ============================================

    containerEl.createEl('h2', { text: '🔧 고급 설정' });

    new Setting(containerEl)
      .setName('디버그 모드')
      .setDesc('개발자 콘솔에 상세 로그 출력')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('캐시 활성화')
      .setDesc('API 응답 및 임베딩 캐싱')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.cacheEnabled)
        .onChange(async (value) => {
          this.plugin.settings.cacheEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('캐시 TTL (초)')
      .setDesc('캐시 유효 시간')
      .addText(text => text
        .setPlaceholder('3600')
        .setValue(this.plugin.settings.cacheTTL.toString())
        .onChange(async (value) => {
          const parsed = parseInt(value);
          if (!isNaN(parsed) && parsed > 0) {
            this.plugin.settings.cacheTTL = parsed;
            await this.plugin.saveSettings();
          }
        }));

    // ============================================
    // Actions Section
    // ============================================

    containerEl.createEl('h2', { text: '🚀 액션' });

    new Setting(containerEl)
      .setName('전체 볼트 인덱싱')
      .setDesc('모든 노트에 대해 임베딩 생성 (시간이 걸릴 수 있음)')
      .addButton(button => button
        .setButtonText('인덱싱 시작')
        .setCta()
        .onClick(async () => {
          new Notice('볼트 인덱싱을 시작합니다...');
          // main.ts의 batch index 커맨드 호출
          (this.app as any).commands.executeCommandById('osba:batch-index');
        }));

    new Setting(containerEl)
      .setName('캐시 초기화')
      .setDesc('모든 캐시된 데이터 삭제')
      .addButton(button => button
        .setButtonText('캐시 삭제')
        .setWarning()
        .onClick(async () => {
          if (confirm('모든 캐시를 삭제하시겠습니까?')) {
            await this.plugin.database.clearCache();
            new Notice('캐시가 삭제되었습니다.');
          }
        }));

    new Setting(containerEl)
      .setName('설정 초기화')
      .setDesc('모든 설정을 기본값으로 되돌림')
      .addButton(button => button
        .setButtonText('초기화')
        .setWarning()
        .onClick(async () => {
          if (confirm('모든 설정을 초기화하시겠습니까?')) {
            this.plugin.settings = { ...DEFAULT_SETTINGS };
            await this.plugin.saveSettings();
            this.display(); // 화면 새로고침
            new Notice('설정이 초기화되었습니다.');
          }
        }));

    // ============================================
    // Statistics Section
    // ============================================

    containerEl.createEl('h2', { text: '📊 통계' });

    this.displayStatistics(containerEl);
  }

  private async displayStatistics(containerEl: HTMLElement): Promise<void> {
    const statsContainer = containerEl.createDiv({ cls: 'osba-stats' });

    try {
      const [indexStats, usageDaily, usageMonthly] = await Promise.all([
        this.plugin.embeddingService?.getIndexingStats(),
        this.plugin.database?.getUsageSummary('day'),
        this.plugin.database?.getUsageSummary('month'),
      ]);

      // 인덱싱 통계
      if (indexStats) {
        statsContainer.createEl('h3', { text: '📁 인덱싱 현황' });
        const indexTable = statsContainer.createEl('table', { cls: 'osba-stats-table' });

        this.addStatRow(indexTable, '전체 노트', `${indexStats.totalNotes}개`);
        this.addStatRow(indexTable, '인덱싱 완료', `${indexStats.indexedNotes}개`);
        this.addStatRow(indexTable, '대기 중', `${indexStats.pendingNotes}개`);
        this.addStatRow(
          indexTable,
          '진행률',
          `${((indexStats.indexedNotes / indexStats.totalNotes) * 100).toFixed(1)}%`
        );
      }

      // 사용량 통계
      if (usageDaily && usageMonthly) {
        statsContainer.createEl('h3', { text: '💰 API 사용량' });
        const usageTable = statsContainer.createEl('table', { cls: 'osba-stats-table' });

        this.addStatRow(
          usageTable,
          '오늘 사용',
          `$${usageDaily.totalCost.toFixed(4)} / $${this.plugin.settings.dailyBudgetLimit.toFixed(2)}`
        );
        this.addStatRow(
          usageTable,
          '이번 달 사용',
          `$${usageMonthly.totalCost.toFixed(4)} / $${this.plugin.settings.monthlyBudgetLimit.toFixed(2)}`
        );
        this.addStatRow(usageTable, '오늘 요청 수', `${usageDaily.requestCount}회`);
        this.addStatRow(usageTable, '이번 달 요청 수', `${usageMonthly.requestCount}회`);
      }
    } catch (error) {
      statsContainer.createEl('p', {
        text: '통계를 불러오는 중 오류가 발생했습니다.',
        cls: 'osba-error',
      });
    }
  }

  private addStatRow(table: HTMLTableElement, label: string, value: string): void {
    const row = table.createEl('tr');
    row.createEl('td', { text: label });
    row.createEl('td', { text: value });
  }

  private async testConnection(provider: ProviderType): Promise<void> {
    new Notice(`${provider} 연결 테스트 중...`);

    try {
      const result = await this.plugin.providerManager.testConnection(provider);

      if (result.success) {
        new Notice(`✅ ${provider} 연결 성공!`);
      } else {
        new Notice(`❌ ${provider} 연결 실패: ${result.error}`);
      }
    } catch (error) {
      new Notice(`❌ 테스트 중 오류 발생: ${error}`);
    }
  }
}
