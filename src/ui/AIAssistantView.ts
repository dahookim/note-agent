import { App, ItemView, WorkspaceLeaf, Setting, Notice, TextAreaComponent, DropdownComponent, ButtonComponent, TFile, MarkdownView } from 'obsidian';
import { withProgressModal } from './progress-modal';
import OSBAPlugin from '../main';
import { ANALYSIS_TEMPLATES, TemplateType, getTemplateById, renderPrompt } from '../core/templates';
import { InsertionMode, SavedPrompt, SourceItem, MultiSourceAnalysisType, AI_ASSISTANT_VIEW_TYPE } from '../types';
import { FileSuggestModal, TextInputModal } from './MultiSourceModals';
import { PromptEditModal } from './PromptEditModal';

export class AIAssistantView extends ItemView {
    private plugin: OSBAPlugin;

    // UI State
    private activeTab: 'note-agent' | 'easy-gate' | 'stargate' | 'custom' | 'multi-source' = 'note-agent';
    private selectedTemplateId: string | null = null;
    // Removed activeFileAtOpen since ItemView remains open and should dynamically fetch the active file
    private customPromptId: string | null = null;
    private promptText: string = '';
    private insertionMode: InsertionMode;
    private outputLanguage: string;
    private isProcessing: boolean = false;
    private noteAgentFeature: 'analyze' | 'quick-draft' | 'similar' | 'index-note' | 'index-all' | 'cost-dashboard' | 'job-queue' = 'analyze';

    // Multi-source State
    private sources: SourceItem[] = [];
    private multiSourceType: MultiSourceAnalysisType = 'synthesis';

    // Preview / Result State
    private viewMode: 'prompt' | 'result' = 'prompt';
    private aiOutput: string = '';

    private usedPromptText: string = '';
    private includePromptInInsert: boolean = false;

    // UI Elements
    private contentContainer!: HTMLElement;
    private previewTextArea!: TextAreaComponent;

    constructor(leaf: WorkspaceLeaf, plugin: OSBAPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.insertionMode = this.plugin.settings.defaultInsertionMode || 'new-note';
        this.outputLanguage = this.plugin.settings.defaultOutputLanguage || 'Auto';
        const initialActiveFile = this.app.workspace.getActiveFile();

        this.updateNoteAgentPrompt();

        // Auto-add current file to multi-source if available
        if (initialActiveFile) {
            this.addActiveNoteToSources(initialActiveFile);
        }
    }

    getViewType(): string {
        return AI_ASSISTANT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'AI 템플릿 마법사 (Note Agent)';
    }

    getIcon(): string {
        return 'brain-circuit';
    }

    private async addActiveNoteToSources(file: TFile) {
        const content = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        this.sources.push({
            id: `source-${Date.now()}`,
            type: 'obsidian-note',
            title: file.basename,
            content: content,
            metadata: {
                filePath: file.path,
                tags: cache?.tags?.map(t => t.tag) || [],
                charCount: content.length,
                wordCount: content.split(/\s+/).filter(w => w).length
            },
            addedAt: new Date().toISOString()
        });
    }

    async onOpen() {
        // Container setup for ItemView
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('osba-view');
        container.addClass('ai-assistant-view');

        const contentEl = container.createDiv({ cls: 'ai-assistant-content' });
        contentEl.style.cssText = 'height: 100%; display: flex; flex-direction: column; overflow-y: auto; padding: 10px;';

        // 헤더 영역 설정
        const headerContainer = contentEl.createDiv();
        headerContainer.style.cssText = 'display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;';

        const titleDiv = headerContainer.createDiv();
        titleDiv.createEl('h2', { text: '✨ AI 템플릿 마법사' }).style.margin = '0 0 5px 0';
        titleDiv.createEl('p', {
            text: '다양한 템플릿을 선택하거나 직접 프롬프트를 작성하여 노트를 생성/수정하세요.',
            cls: 'osba-modal-desc',
        }).style.margin = '0';

        // 모델 선택 UI
        const modelSettingsContainer = headerContainer.createDiv();
        modelSettingsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; background: var(--background-secondary-alt); padding: 10px; border-radius: 8px; border: 1px solid var(--background-modifier-border); min-width: 250px;';

        // LLM 모델 드롭다운
        const llmSetting = new Setting(modelSettingsContainer)
            .setName('🎯 LLM')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('claude-sonnet-4', 'Claude Sonnet 4')
                    .addOption('claude-opus-4', 'Claude Opus 4')
                    .addOption('claude-opus-4.5', 'Claude Opus 4.5')
                    .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
                    .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
                    .addOption('gpt-4.1', 'GPT-4.1')
                    .addOption('gpt-4o', 'GPT-4o')
                    .addOption('grok-4-fast', 'Grok 4.1 Fast');

                this.plugin.settings.customApiModels?.filter(m => m.type === 'generation' || m.type === 'both').forEach(model => {
                    dropdown.addOption(model.id, `[Custom] ${model.name}`);
                });

                dropdown.setValue(this.plugin.settings.analysisModel)
                    .onChange(async (value) => {
                        this.plugin.settings.analysisModel = value;
                        this.plugin.settings.quickDraftModel = value;
                        await this.plugin.saveSettings();
                        new Notice(`LLM 모델 변경됨: ${value}`);
                    });

                dropdown.selectEl.style.width = '140px';
            });
        llmSetting.settingEl.style.border = 'none';
        llmSetting.settingEl.style.padding = '0';

        // Embedding 모델 드롭다운
        const embedSetting = new Setting(modelSettingsContainer)
            .setName('🧠 임베딩')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('openai-small', 'text-embedding-3-small')
                    .addOption('openai-large', 'text-embedding-3-large');

                this.plugin.settings.customApiModels?.filter(m => m.type === 'embedding' || m.type === 'both').forEach(model => {
                    dropdown.addOption(model.id, `[Custom] ${model.name}`);
                });

                dropdown.setValue(this.plugin.settings.embeddingModel)
                    .onChange(async (value) => {
                        this.plugin.settings.embeddingModel = value;
                        this.plugin.settings.useCustomModels = false; // 기본 모델 리셋 로직을 위해 false 방어
                        await this.plugin.saveSettings();
                        new Notice(`임베딩 모델 변경됨: ${value}`);
                    });
                dropdown.selectEl.style.width = '140px';
            });
        embedSetting.settingEl.style.border = 'none';
        embedSetting.settingEl.style.padding = '0';


        // 메인 레이아웃 (왼쪽 탭/옵션, 오른쪽 미리보기) -> 세로 레이아웃(위: 탭/옵션, 아래: 미리보기)
        const mainContainer = contentEl.createDiv({ cls: 'assistant-main-container' });
        mainContainer.style.cssText = 'display: flex; flex-direction: column; gap: 20px; width: 100%;';

        const leftPanel = mainContainer.createDiv({ cls: 'assistant-left-panel' });
        leftPanel.style.cssText = 'width: 100%;';

        const rightPanel = mainContainer.createDiv({ cls: 'assistant-right-panel' });
        rightPanel.style.cssText = 'width: 100%; display: flex; flex-direction: column; gap: 10px;';

        this.renderTabs(leftPanel);

        this.contentContainer = leftPanel.createDiv({ cls: 'assistant-tab-content' });
        this.contentContainer.style.cssText = 'min-height: 250px; padding: 10px 0;';

        this.renderTabContent();

        this.renderRightPanel(rightPanel);

        this.renderFooter(contentEl);
    }

    private renderTabs(container: HTMLElement) {
        const tabContainer = container.createDiv({ cls: 'osba-tabs' });
        tabContainer.style.cssText = 'display: flex; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 15px; overflow-x: auto; white-space: nowrap; padding-bottom: 4px;';

        const createTab = (id: typeof this.activeTab, label: string) => {
            const tabEl = tabContainer.createDiv({ cls: 'osba-tab' });
            tabEl.setText(label);
            tabEl.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                margin-bottom: -1px;
                ${this.activeTab === id ? 'border-bottom-color: var(--interactive-accent); color: var(--interactive-accent); font-weight: bold;' : 'color: var(--text-muted);'}
            `;

            tabEl.onclick = () => {
                this.activeTab = id;
                // 리셋 상태 (탭 전환 시)
                this.selectedTemplateId = null;
                this.customPromptId = null;
                this.viewMode = 'prompt';

                // 각 탭별 기본 선택
                if (id === 'easy-gate') this.selectedTemplateId = 'basic-summary';
                else if (id === 'stargate') this.selectedTemplateId = 'briefing';
                else if (id === 'multi-source') this.updateMultiSourcePrompt();
                else if (id === 'note-agent') this.updateNoteAgentPrompt();

                // 프롬프트 강제 동기화 (커스텀/멀티소스/노트에이전트 탭이 아닌경우)
                if (id !== 'custom' && id !== 'multi-source' && id !== 'note-agent') this.updatePreviewText();

                this.onOpen(); // 다시 렌더링
            };
        };

        createTab('note-agent', 'Note Agent');
        createTab('easy-gate', 'Easy Gate');
        createTab('stargate', 'Stargate');
        createTab('custom', 'Custom');
        createTab('multi-source', 'Multi-Source');
    }

    private renderTabContent() {
        this.contentContainer.empty();

        if (this.activeTab === 'easy-gate') {
            const easyGateTemplates = ANALYSIS_TEMPLATES.slice(0, 6);
            this.renderTemplateGrid(easyGateTemplates);
        } else if (this.activeTab === 'stargate') {
            const stargateTemplates = ANALYSIS_TEMPLATES.slice(6);
            this.renderTemplateGrid(stargateTemplates);
        } else if (this.activeTab === 'custom') {
            this.renderCustomTab();
        } else if (this.activeTab === 'multi-source') {
            this.renderMultiSourceTypeList(this.contentContainer);
        } else if (this.activeTab === 'note-agent') {
            this.renderNoteAgentTab();
        }
    }

    private renderMultiSourceTypeList(container: HTMLElement) {
        container.createEl('h3', { text: '멀티 소스 분석 유형' }).style.margin = '0 0 10px 0';

        const listDiv = container.createDiv();
        listDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;';

        // 1) 빌트인 3가지 유형
        const builtinTypes: { id: MultiSourceAnalysisType; label: string; desc: string }[] = [
            { id: 'synthesis', label: '종합 분석', desc: '모든 소스를 융합하여 요약' },
            { id: 'basic', label: '기본 분석', desc: '소스간 핵심 내용 비교 분석' },
            { id: 'summary', label: '개별 요약', desc: '각 소스 요약 후 종합' },
        ];

        builtinTypes.forEach(type => {
            const isSelected = this.multiSourceType === type.id && !this.customPromptId;
            const row = listDiv.createDiv();
            row.style.cssText = `
                padding: 10px; border-radius: 6px; cursor: pointer; 
                border: 1px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                background: ${isSelected ? 'var(--background-modifier-hover)' : 'transparent'};
                transition: all 0.2s ease-in-out;
            `;
            row.createDiv({ text: type.label }).style.cssText = 'font-weight: bold; margin-bottom: 4px;';
            row.createDiv({ text: type.desc }).style.cssText = 'font-size: 12px; color: var(--text-muted);';
            row.onclick = () => {
                this.multiSourceType = type.id;
                this.customPromptId = null;
                this.updateMultiSourcePrompt();
                this.onOpen();
            };
        });

        // 2) 저장된 멀티소스 커스텀 프롬프트 버튼들
        const msPrompts = (this.plugin.settings.savedPrompts || []).filter((p: SavedPrompt) => p.source === 'multi-source');
        if (msPrompts.length > 0) {
            const divider = listDiv.createDiv();
            divider.style.cssText = 'margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--background-modifier-border);';
            divider.createEl('span', { text: '💾 저장된 커스텀 분석' }).style.cssText = 'font-size: 12px; color: var(--text-muted); font-weight: 500;';

            msPrompts.forEach((savedPrompt: SavedPrompt) => {
                const isSelected = this.multiSourceType === 'custom' && this.customPromptId === savedPrompt.id;
                const row = listDiv.createDiv();
                row.style.cssText = `
                    padding: 10px; border-radius: 6px; cursor: pointer;
                    border: 1px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                    background: ${isSelected ? 'var(--background-modifier-hover)' : 'transparent'};
                    transition: all 0.2s ease-in-out;
                    display: flex; justify-content: space-between; align-items: center;
                `;

                const textDiv = row.createDiv();
                textDiv.style.cssText = 'flex: 1; min-width: 0;';
                textDiv.createDiv({ text: `💬 ${savedPrompt.name}` }).style.cssText = 'font-weight: bold; margin-bottom: 2px;';
                if (savedPrompt.description) {
                    textDiv.createDiv({ text: savedPrompt.description }).style.cssText = 'font-size: 11px; color: var(--text-muted);';
                }

                row.onclick = () => {
                    this.multiSourceType = 'custom';
                    this.customPromptId = savedPrompt.id;
                    this.promptText = savedPrompt.prompt;
                    this.onOpen();
                };

                const btnGroup = row.createDiv();
                btnGroup.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

                const editBtn = btnGroup.createEl('button', { text: '편집' });
                editBtn.style.fontSize = '11px';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    new PromptEditModal(this.app, async (name, description, promptBody) => {
                        savedPrompt.name = name;
                        savedPrompt.description = description;
                        savedPrompt.prompt = promptBody;
                        await this.plugin.saveSettings();
                        new Notice('프롬프트가 수정되었습니다.');
                        if (this.customPromptId === savedPrompt.id) {
                            this.promptText = promptBody;
                        }
                        this.onOpen();
                    }, savedPrompt).open();
                };

                const delBtn = btnGroup.createEl('button', { text: '삭제' });
                delBtn.style.fontSize = '11px';
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`'${savedPrompt.name}' 프롬프트를 삭제하시겠습니까?`)) {
                        this.plugin.settings.savedPrompts = this.plugin.settings.savedPrompts.filter((p: SavedPrompt) => p.id !== savedPrompt.id);
                        await this.plugin.saveSettings();
                        if (this.customPromptId === savedPrompt.id) {
                            this.customPromptId = null;
                            this.promptText = '';
                        }
                        this.onOpen();
                    }
                };
            });
        }

        // 3) "커스텀 프롬프트 추가" 버튼 (맨 마지막)
        const addCustomRow = listDiv.createDiv();
        const isNewCustomSelected = this.multiSourceType === 'custom' && !this.customPromptId;
        addCustomRow.style.cssText = `
            padding: 10px; border-radius: 6px; cursor: pointer;
            border: 1px dashed ${isNewCustomSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
            background: ${isNewCustomSelected ? 'var(--background-modifier-hover)' : 'transparent'};
            transition: all 0.2s ease-in-out;
            text-align: center; margin-top: 4px;
        `;
        addCustomRow.createDiv({ text: '+ 커스텀 프롬프트 추가' }).style.cssText = 'font-weight: bold; color: var(--text-muted);';
        addCustomRow.createDiv({ text: '직접 작성한 지시사항으로 새 프롬프트 생성' }).style.cssText = 'font-size: 11px; color: var(--text-faint);';
        addCustomRow.onclick = () => {
            this.multiSourceType = 'custom';
            this.customPromptId = null;
            this.promptText = '';
            this.onOpen();
        };
    }

    private updateMultiSourcePrompt() {
        if (this.multiSourceType === 'synthesis') this.promptText = '제공된 모든 자료의 내용을 종합하여 핵심 인사이트를 포함하는 통합 요약본을 작성해 주세요.';
        else if (this.multiSourceType === 'basic') this.promptText = '각 자료의 핵심 주장을 파악하고 공통점과 차이점을 중심으로 비교 분석해 주세요.';
        else if (this.multiSourceType === 'summary') this.promptText = '제공된 자료들을 각각 먼저 3줄로 요약한 뒤, 전체 자료들을 아우르는 결론을 도출해 주세요.';
        else if (this.multiSourceType === 'custom') {
            if (this.promptText === '제공된 모든 자료의 내용을 종합하여 핵심 인사이트를 포함하는 통합 요약본을 작성해 주세요.' ||
                this.promptText === '각 자료의 핵심 주장을 파악하고 공통점과 차이점을 중심으로 비교 분석해 주세요.' ||
                this.promptText === '제공된 자료들을 각각 먼저 3줄로 요약한 뒤, 전체 자료들을 아우르는 결론을 도출해 주세요.') {
                this.promptText = '';
            }
        }
    }

    private renderTemplateGrid(templates: typeof ANALYSIS_TEMPLATES) {
        const grid = this.contentContainer.createDiv({ cls: 'template-grid' });
        grid.style.cssText = 'display: grid; grid-template-columns: 1fr; gap: 10px;';

        templates.forEach(template => {
            const card = grid.createDiv({ cls: 'template-card' });
            card.style.cssText = `
                padding: 10px;
                border-radius: 6px;
                border: 2px solid var(--background-modifier-border);
                background: var(--background-primary);
                cursor: pointer;
                transition: all 0.2s;
            `;

            if (this.selectedTemplateId === template.id) {
                card.style.borderColor = 'var(--interactive-accent)';
                card.style.background = 'var(--background-secondary)';
            }

            const header = card.createDiv();
            header.style.cssText = 'display: flex; align-items: center; gap: 6px; font-weight: bold; margin-bottom: 4px;';
            header.createSpan({ text: template.icon });
            header.createSpan({ text: template.name });

            card.createDiv({ text: template.description }).style.cssText = 'font-size: 11px; color: var(--text-muted);';

            card.onclick = () => {
                this.isProcessing = false;
                this.selectedTemplateId = template.id;
                this.updatePreviewText();
                this.onOpen(); // Re-render to update UI selection
            };
        });
    }

    private renderCustomTab() {
        const customContainer = this.contentContainer.createDiv();

        const controls = customContainer.createDiv();
        controls.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';

        controls.createEl('h3', { text: '💾 내 프롬프트' }).style.margin = '0';

        new ButtonComponent(controls)
            .setButtonText('+ 새 프롬프트')
            .onClick(() => {
                this.customPromptId = null;
                this.promptText = '';
                this.selectedTemplateId = 'custom';
                this.onOpen();
            });

        const listContainer = customContainer.createDiv();
        listContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto;';

        if (!this.plugin.settings.savedPrompts || this.plugin.settings.savedPrompts.length === 0) {
            listContainer.createEl('p', { text: '저장된 커스텀 프롬프트가 없습니다.', cls: 'osba-modal-desc' });
        } else {
            // 커스텀 탭에는 source가 없거나 'custom'인 프롬프트만 표시
            const customPrompts = this.plugin.settings.savedPrompts.filter((p: SavedPrompt) => !p.source || p.source === 'custom');
            if (customPrompts.length === 0) {
                listContainer.createEl('p', { text: '저장된 커스텀 프롬프트가 없습니다.', cls: 'osba-modal-desc' });
            } else {
                customPrompts.forEach((savedPrompt: SavedPrompt) => {
                    const item = listContainer.createDiv();
                    item.style.cssText = `
                        display: flex; justify-content: space-between; align-items: center; 
                        padding: 8px 12px; border: 1px solid var(--background-modifier-border); 
                        border-radius: 6px; cursor: pointer;
                    `;

                    if (this.customPromptId === savedPrompt.id) {
                        item.style.borderColor = 'var(--interactive-accent)';
                        item.style.background = 'var(--background-secondary)';
                    }

                    // 전체 아이템 클릭 시 프롬프트 적용
                    item.onclick = () => {
                        this.customPromptId = savedPrompt.id;
                        this.promptText = savedPrompt.prompt;
                        this.selectedTemplateId = 'custom';
                        this.onOpen();
                    };

                    const textDiv = item.createDiv();
                    textDiv.style.cssText = 'flex: 1; min-width: 0;';
                    textDiv.createDiv({ text: `💬 ${savedPrompt.name}` }).style.fontWeight = '500';
                    if (savedPrompt.description) {
                        textDiv.createDiv({ text: savedPrompt.description }).style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 2px;';
                    }

                    const btnGroup = item.createDiv();
                    btnGroup.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

                    const editBtn = btnGroup.createEl('button', { text: '편집' });
                    editBtn.style.fontSize = '12px';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        new PromptEditModal(this.app, async (name, description, promptBody) => {
                            savedPrompt.name = name;
                            savedPrompt.description = description;
                            savedPrompt.prompt = promptBody;
                            await this.plugin.saveSettings();
                            new Notice('프롬프트가 수정되었습니다.');
                            if (this.customPromptId === savedPrompt.id) {
                                this.promptText = promptBody;
                            }
                            this.onOpen();
                        }, savedPrompt).open();
                    };

                    const delBtn = btnGroup.createEl('button', { text: '삭제' });
                    delBtn.style.fontSize = '12px';
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (confirm(`'${savedPrompt.name}' 프롬프트를 삭제하시겠습니까?`)) {
                            this.plugin.settings.savedPrompts = this.plugin.settings.savedPrompts.filter((p: SavedPrompt) => p.id !== savedPrompt.id);
                            await this.plugin.saveSettings();
                            if (this.customPromptId === savedPrompt.id) {
                                this.customPromptId = null;
                                this.promptText = '';
                            }
                            this.onOpen();
                        }
                    };
                });
            }
        }
    }

    private renderNoteAgentTab() {
        const container = this.contentContainer;
        container.createEl('h3', { text: 'Note Agent 기능' }).style.margin = '0 0 10px 0';

        const listDiv = container.createDiv();
        listDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;';

        const features: { id: 'analyze' | 'quick-draft' | 'similar' | 'index-note' | 'index-all' | 'cost-dashboard' | 'job-queue'; icon: string; label: string; desc: string }[] = [
            { id: 'analyze', icon: '🔗', label: '연결 분석', desc: 'AI로 노트 간 연결 및 지식 갭 분석' },
            { id: 'quick-draft', icon: '✨', label: '빠른 초안', desc: '관련 노트 컨텍스트로 새 콘텐츠 생성' },
            { id: 'similar', icon: '🔍', label: '유사 노트 찾기', desc: '임베딩 기반 유사 노트 검색' },
            { id: 'index-note', icon: '📝', label: '현재 노트 인덱싱', desc: '현재 노트 임베딩 생성' },
            { id: 'index-all', icon: '📦', label: '전체 인덱싱', desc: 'Vault 전체 노트 임베딩 생성' },
            { id: 'cost-dashboard', icon: '💰', label: '비용 대시보드', desc: 'AI 사용량 및 비용 확인' },
            { id: 'job-queue', icon: '📋', label: '작업 대기열', desc: '진행 중인 작업 확인' },
        ];

        features.forEach(f => {
            const isSelected = this.noteAgentFeature === f.id;
            const row = listDiv.createDiv();
            row.style.cssText = `
                padding: 10px; border-radius: 6px; cursor: pointer;
                border: 1px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                background: ${isSelected ? 'var(--background-modifier-hover)' : 'transparent'};
                transition: all 0.2s ease-in-out;
            `;
            row.createDiv({ text: `${f.icon} ${f.label}` }).style.cssText = 'font-weight: bold; margin-bottom: 2px;';
            row.createDiv({ text: f.desc }).style.cssText = 'font-size: 12px; color: var(--text-muted);';
            row.onclick = () => {
                this.noteAgentFeature = f.id;
                this.viewMode = 'prompt';
                this.updateNoteAgentPrompt();
                this.onOpen();
            };
        });
    }

    private updateNoteAgentPrompt() {
        if (this.noteAgentFeature === 'analyze') {
            this.promptText = '현재 노트를 AI로 분석하여 다른 노트와의 연결 관계와 지식 갭을 발견합니다.\n\n분석 기준:\n1. 개념적 연관성\n2. 논리적 관계 (확장/지지/반박)\n3. 사례 관계\n4. 지식 갭 발견';
        } else if (this.noteAgentFeature === 'quick-draft') {
            if (!this.promptText || this.promptText.startsWith('현재 노트를 AI로') || this.promptText.startsWith('현재 노트와 의미적으로')) {
                this.promptText = '';
            }
        } else if (this.noteAgentFeature === 'similar') {
            this.promptText = '현재 노트와 의미적으로 유사한 노트 10개를 임베딩 벡터 기반으로 검색합니다.\n\n(AI 프롬프트 없이 임베딩 유사도로 검색)';
        }
    }

    private renderNoteAgentRightPanel(container: HTMLElement) {
        const feature = this.noteAgentFeature;

        // 유틸/뷰 기능: 즉시 실행 UI
        if (feature === 'index-note' || feature === 'index-all' || feature === 'cost-dashboard' || feature === 'job-queue') {
            const labels: Record<string, { icon: string; title: string; desc: string; btnText: string }> = {
                'index-note': { icon: '📝', title: '현재 노트 인덱싱', desc: '현재 노트의 임베딩 벡터를 생성하여 데이터베이스에 저장합니다. 유사 노트 검색, 연결 분석 등의 전제 조건입니다.', btnText: '🚀 인덱싱 실행' },
                'index-all': { icon: '📦', title: '전체 Vault 인덱싱', desc: 'Vault 내 모든 마크다운 노트의 임베딩 벡터를 생성합니다. 노트 수에 따라 시간이 걸릴 수 있습니다.', btnText: '🚀 전체 인덱싱 실행' },
                'cost-dashboard': { icon: '💰', title: '비용 대시보드', desc: 'AI 사용량 및 비용을 사이드바에서 확인합니다.', btnText: '📊 대시보드 열기' },
                'job-queue': { icon: '📋', title: '작업 대기열', desc: '진행 중인 작업 목록을 사이드바에서 확인합니다.', btnText: '📋 대기열 열기' },
            };
            const info = labels[feature];
            container.createEl('h3', { text: `${info.icon} ${info.title}` }).style.margin = '0 0 10px 0';
            container.createEl('p', { text: info.desc, cls: 'osba-modal-desc' }).style.margin = '0 0 20px 0';

            new ButtonComponent(container)
                .setButtonText(info.btnText)
                .setCta()
                .onClick(async () => {
                    if (feature === 'index-note') {
                        const file = this.app.workspace.getActiveFile();
                        if (file && file.extension === 'md') {
                            await this.plugin.generateEmbedding(file);
                            new Notice('인덱싱 완료!');
                        } else {
                            new Notice('활성화된 마크다운 노트가 없습니다.');
                        }
                    } else if (feature === 'index-all') {
                        await this.plugin.batchIndexVault();
                    } else if (feature === 'cost-dashboard') {
                        this.plugin.activateView('cost-dashboard');
                    } else if (feature === 'job-queue') {
                        this.plugin.activateView('job-queue');
                    }
                });
            return;
        }

        // AI/임베딩 기능: 프롬프트/결과 플로우
        const isPromptMode = this.viewMode === 'prompt';
        const headerText = isPromptMode ? '👁️ 프롬프트 미리보기' : '✨ AI 생성 결과 (편집 가능)';
        container.createEl('h3', { text: headerText }).style.margin = '0 0 5px 0';

        if (!isPromptMode) {
            container.createEl('p', { text: '아래 텍스트를 직접 수정한 뒤 원하는 노트 위치에 삽입할 수 있습니다.', cls: 'osba-modal-desc' }).style.margin = '0 0 10px 0';
            if (this.usedPromptText) {
                const promptBlock = container.createDiv();
                promptBlock.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px; margin-bottom: 10px; max-height: 100px; overflow-y: auto;';
                promptBlock.createEl('div', { text: '📋 요청 프롬프트' }).style.cssText = 'font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);';
                promptBlock.createEl('div', { text: this.usedPromptText }).style.cssText = 'font-size: 12px; color: var(--text-normal); white-space: pre-wrap; word-break: break-word;';
            }
        }

        const isEditable = isPromptMode && feature === 'quick-draft';

        const textAreaSetting = new Setting(container)
            .setClass('assistant-preview-setting')
            .addTextArea(text => {
                this.previewTextArea = text;
                text.setValue(isPromptMode ? this.promptText : this.aiOutput);
                text.inputEl.style.cssText = `width: 100%; min-height: ${isPromptMode ? '150px' : '280px'}; resize: vertical; font-size: 13px;`;
                if (isPromptMode) {
                    if (isEditable) {
                        text.setPlaceholder('작성할 내용을 설명해주세요...');
                        text.onChange(value => { this.promptText = value; });
                    } else {
                        text.setDisabled(true);
                    }
                } else {
                    text.setDisabled(false);
                    text.onChange(value => { this.aiOutput = value; });
                }
            });
        textAreaSetting.settingEl.style.border = 'none';
        textAreaSetting.settingEl.style.padding = '0';
    }

    private updatePreviewText() {
        if (this.selectedTemplateId && this.selectedTemplateId !== 'custom') {
            const template = getTemplateById(this.selectedTemplateId);
            if (template) {
                // Here we show what the prompt actually is.
                this.promptText = template.userPromptTemplate;
            }
        }
    }

    private renderRightPanel(container: HTMLElement) {
        if (this.activeTab === 'multi-source' && this.viewMode === 'prompt') {
            this.renderMultiSourceRightPanel(container);
            return;
        }

        if (this.activeTab === 'note-agent') {
            this.renderNoteAgentRightPanel(container);
            return;
        }

        const isPromptMode = this.viewMode === 'prompt';
        const headerText = isPromptMode ? '👁️ 프롬프트 미리보기' : '✨ AI 생성 결과 (편집 가능)';
        container.createEl('h3', { text: headerText }).style.margin = '0 0 5px 0';

        if (!isPromptMode) {
            container.createEl('p', {
                text: '아래 텍스트를 직접 수정한 뒤 원하는 노트 위치에 삽입할 수 있습니다.',
                cls: 'osba-modal-desc',
            }).style.margin = '0 0 10px 0';

            // 요청 프롬프트 표시
            if (this.usedPromptText) {
                const promptBlock = container.createDiv();
                promptBlock.style.cssText = `
                    background: var(--background-secondary); 
                    border: 1px solid var(--background-modifier-border); 
                    border-radius: 6px; padding: 10px; margin-bottom: 10px;
                    max-height: 100px; overflow-y: auto;
                `;
                promptBlock.createEl('div', { text: '📋 요청 프롬프트' }).style.cssText = 'font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);';
                promptBlock.createEl('div', { text: this.usedPromptText }).style.cssText = 'font-size: 12px; color: var(--text-normal); white-space: pre-wrap; word-break: break-word;';
            }
        }

        const isCustom = this.activeTab === 'custom';

        const textAreaSetting = new Setting(container)
            .setClass('assistant-preview-setting')
            .addTextArea(text => {
                this.previewTextArea = text;
                text.setValue(isPromptMode ? this.promptText : this.aiOutput);
                text.inputEl.style.cssText = `
                    width: 100%;
                    min-height: ${isPromptMode ? '180px' : '280px'};
                    resize: vertical;
                    font-size: 13px;
                `;

                if (isPromptMode) {
                    if (!isCustom) {
                        text.setDisabled(true); // Default 템플릿들은 읽기 전용
                    } else {
                        text.setPlaceholder('커스텀 프롬프트를 작성하세요...');
                        text.onChange(value => {
                            this.promptText = value;
                        });
                    }
                } else {
                    // Result mode is always editable
                    text.setDisabled(false);
                    text.onChange(value => {
                        this.aiOutput = value;
                    });
                }
            });

        textAreaSetting.settingEl.style.border = 'none';
        textAreaSetting.settingEl.style.padding = '0';

        // "Custom" 탭이고 현재 작성중인 프롬프트가 있으면 저장 버튼 스니펫 
        if (isPromptMode && isCustom) {
            const saveRow = container.createDiv();
            saveRow.style.cssText = 'display: flex; justify-content: flex-end; margin-top: 5px;';

            new ButtonComponent(saveRow)
                .setButtonText(this.customPromptId ? '💾 덮어쓰기 저장' : '💾 새 프롬프트 저장')
                .onClick(async () => {
                    if (!this.promptText.trim()) {
                        new Notice('프롬프트 내용이 비어있습니다.');
                        return;
                    }

                    if (this.customPromptId) {
                        const existing = this.plugin.settings.savedPrompts.find((p: SavedPrompt) => p.id === this.customPromptId);
                        if (existing) {
                            existing.prompt = this.promptText;
                            await this.plugin.saveSettings();
                            new Notice('프롬프트가 수정되었습니다.');
                            this.onOpen();
                            return;
                        }
                    }

                    // 새 프롬프트 — PromptEditModal 사용
                    new PromptEditModal(this.app, async (name, description, promptBody) => {
                        const newPrompt: SavedPrompt = {
                            id: `custom-${Date.now()}`,
                            name,
                            description: description || undefined,
                            prompt: promptBody,
                            source: 'custom'
                        };
                        if (!this.plugin.settings.savedPrompts) {
                            this.plugin.settings.savedPrompts = [];
                        }
                        this.plugin.settings.savedPrompts.push(newPrompt);
                        await this.plugin.saveSettings();
                        this.customPromptId = newPrompt.id;
                        new Notice('새 프롬프트가 저장되었습니다.');
                        this.onOpen();
                    }, { id: '', name: '', description: '', prompt: this.promptText }).open();
                });
        }
    }

    private renderMultiSourceRightPanel(container: HTMLElement) {
        // Source Manager UI
        const sourceManagerContainer = container.createDiv({ cls: 'source-manager-section' });
        sourceManagerContainer.style.cssText = `
            background: var(--background-secondary);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 15px;
        `;

        const headerRow = sourceManagerContainer.createDiv();
        headerRow.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;`;
        headerRow.createEl('strong', { text: '📚 참조 소스' });

        const addButtonsRow = headerRow.createDiv();
        addButtonsRow.style.cssText = `display: flex; gap: 8px;`;

        const addNoteBtn = addButtonsRow.createEl('button', { text: '📄 노트 추가' });
        addNoteBtn.style.padding = '4px 8px';
        addNoteBtn.onclick = () => {
            new FileSuggestModal(this.app, async (file: TFile) => {
                await this.addActiveNoteToSources(file);
                this.onOpen();
                new Notice(`노트 추가됨: ${file.basename}`);
            }).open();
        };

        const addTextBtn = addButtonsRow.createEl('button', { text: '✏️ 텍스트 추가' });
        addTextBtn.style.padding = '4px 8px';
        addTextBtn.onclick = () => {
            new TextInputModal(this.app, (title, content) => {
                this.sources.push({
                    id: `source-${Date.now()}`,
                    type: 'manual-input',
                    title,
                    content,
                    metadata: {
                        charCount: content.length,
                        wordCount: content.split(/\s+/).filter(w => w).length
                    },
                    addedAt: new Date().toISOString()
                });
                this.onOpen();
                new Notice(`텍스트 추가됨: ${title}`);
            }).open();
        };

        const listDiv = sourceManagerContainer.createDiv();
        listDiv.style.cssText = `max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;`;

        if (this.sources.length === 0) {
            listDiv.createEl('p', { text: '추가된 소스가 없습니다. 위 버튼을 눌러 소스를 추가해주세요.', cls: 'empty-state-text' })
                .style.cssText = 'color: var(--text-muted); font-size: 12px; margin: 5px 0; text-align: center;';
        } else {
            this.sources.forEach((source, index) => {
                const itemDiv = listDiv.createDiv();
                itemDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--background-primary); border-radius: 4px; border: 1px solid var(--background-modifier-border);';

                const infoDiv = itemDiv.createDiv();
                infoDiv.createSpan({ text: source.type === 'obsidian-note' ? '📄 ' : '📝 ' });
                infoDiv.createSpan({ text: source.title }).style.fontWeight = '500';
                infoDiv.createSpan({ text: ` (${source.metadata.charCount.toLocaleString()}자)` }).style.cssText = 'font-size: 11px; color: var(--text-muted);';

                const deleteBtn = itemDiv.createEl('button', { text: '🗑️' });
                deleteBtn.style.cssText = 'background: transparent; border: none; padding: 2px 5px; cursor: pointer;';
                deleteBtn.onclick = () => {
                    this.sources.splice(index, 1);
                    this.onOpen();
                };
            });
        }

        // Custom Prompt Entry
        container.createEl('h3', { text: '💬 분석 지시사항' }).style.margin = '0 0 5px 0';
        const textAreaSetting = new Setting(container)
            .setClass('assistant-preview-setting')
            .addTextArea(text => {
                this.previewTextArea = text;
                text.setValue(this.promptText);
                text.inputEl.style.cssText = `
                    width: 100%;
                    min-height: 120px;
                    resize: vertical;
                    font-size: 13px;
                `;
                if (this.multiSourceType !== 'custom') {
                    text.setDisabled(true);
                } else {
                    text.setPlaceholder('커스텀 분석 지시사항을 작성하세요...');
                    text.onChange(value => {
                        this.promptText = value;
                    });
                }
            });
        textAreaSetting.settingEl.style.border = 'none';
        textAreaSetting.settingEl.style.padding = '0';

        // Saving logic for Multi-source custom instruction
        if (this.multiSourceType === 'custom') {
            const saveRow = container.createDiv();
            saveRow.style.cssText = 'display: flex; justify-content: flex-end; margin-top: 5px;';

            new ButtonComponent(saveRow)
                .setButtonText('💾 현재 프롬프트 유지/저장')
                .onClick(async () => {
                    if (!this.promptText.trim()) {
                        new Notice('프롬프트 내용이 비어있습니다.');
                        return;
                    }

                    if (this.customPromptId) {
                        const existing = this.plugin.settings.savedPrompts.find((p: SavedPrompt) => p.id === this.customPromptId);
                        if (existing) {
                            existing.prompt = this.promptText;
                            await this.plugin.saveSettings();
                            new Notice('프롬프트가 수정되었습니다.');
                            this.onOpen();
                            return;
                        }
                    }

                    // 새 프롬프트 — PromptEditModal 사용
                    new PromptEditModal(this.app, async (name, description, promptBody) => {
                        const newPrompt: SavedPrompt = {
                            id: `custom-ms-${Date.now()}`,
                            name,
                            description: description || undefined,
                            prompt: promptBody,
                            source: 'multi-source'
                        };
                        if (!this.plugin.settings.savedPrompts) {
                            this.plugin.settings.savedPrompts = [];
                        }
                        this.plugin.settings.savedPrompts.push(newPrompt);
                        await this.plugin.saveSettings();
                        this.customPromptId = newPrompt.id;
                        new Notice('새 프롬프트가 저장되었습니다.');
                        this.onOpen();
                    }, { id: '', name: '', description: '', prompt: this.promptText }).open();
                });
        }
    }

    private renderFooter(container: HTMLElement) {
        const footerInfo = container.createDiv();
        footerInfo.style.cssText = 'margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 12px; width: 100%;';

        const languageGroup = footerInfo.createDiv();
        languageGroup.style.display = 'flex';
        languageGroup.style.flexDirection = 'column';
        languageGroup.style.gap = '5px';
        languageGroup.style.width = '100%';
        languageGroup.createSpan({ text: '출력 언어:', cls: 'setting-item-name' });

        const langDropdown = new DropdownComponent(languageGroup);
        langDropdown.addOption('Auto', 'Auto (기본값)');
        langDropdown.addOption('한국어', '한국어');
        langDropdown.addOption('English', 'English');
        langDropdown.addOption('日本語', '日本語');
        langDropdown.addOption('中文', '中文');
        langDropdown.setValue(this.outputLanguage);
        langDropdown.onChange(async (val: string) => {
            this.outputLanguage = val;
            this.plugin.settings.defaultOutputLanguage = this.outputLanguage;
            await this.plugin.saveSettings();
        });

        langDropdown.selectEl.style.width = '100%';

        const insertOptionsGroup = footerInfo.createDiv();
        insertOptionsGroup.style.display = 'flex';
        insertOptionsGroup.style.flexDirection = 'column';
        insertOptionsGroup.style.gap = '5px';
        insertOptionsGroup.style.width = '100%';

        insertOptionsGroup.createSpan({ text: '출력 위치:', cls: 'setting-item-name' });

        const dropdown = new DropdownComponent(insertOptionsGroup);
        dropdown.addOption('new-note', '📄 새 노트 생성');
        dropdown.addOption('cursor', '📍 현재 커서 위치에 삽입');
        dropdown.addOption('end-of-note', '⬇️ 현재 노트 맨 끝에 추가');
        dropdown.setValue(this.insertionMode);
        dropdown.onChange(async (val: string) => {
            this.insertionMode = val as InsertionMode;
            this.plugin.settings.defaultInsertionMode = this.insertionMode;
            await this.plugin.saveSettings();
        });
        dropdown.selectEl.style.width = '100%';

        const actionGroup = footerInfo.createDiv();
        actionGroup.style.display = 'flex';
        actionGroup.style.flexDirection = 'column';
        actionGroup.style.gap = '10px';
        actionGroup.style.width = '100%';

        if (this.viewMode === 'prompt') {
            const aiBtn = new ButtonComponent(actionGroup)
                .setButtonText('🚀 AI 실행')
                .setCta()
                .onClick(async () => {
                    if (!this.promptText || this.promptText.trim() === '') {
                        new Notice('프롬프트가 비어있습니다.');
                        return;
                    }

                    if (this.isProcessing) return;

                    await this.executeAI();
                });
            aiBtn.buttonEl.style.width = '100%';
        } else {
            const backBtn = new ButtonComponent(actionGroup)
                .setButtonText('🔙 이전으로')
                .onClick(() => {
                    this.viewMode = 'prompt';
                    this.onOpen();
                });
            backBtn.buttonEl.style.width = '100%';

            // 프롬프트 포함 체크박스
            if (this.usedPromptText) {
                const checkboxRow = actionGroup.createDiv();
                checkboxRow.style.cssText = 'display: flex; align-items: center; gap: 4px;';
                const cb = checkboxRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                cb.checked = this.includePromptInInsert;
                cb.onchange = () => { this.includePromptInInsert = cb.checked; };
                checkboxRow.createEl('span', { text: '프롬프트 포함' }).style.cssText = 'font-size: 12px;';
            }

            const insertBtn = new ButtonComponent(actionGroup)
                .setButtonText('📥 결과 삽입하기')
                .setCta()
                .onClick(async () => {
                    let output = this.aiOutput;
                    if (this.includePromptInInsert && this.usedPromptText) {
                        output = `> **📋 요청 프롬프트**\n> ${this.usedPromptText.replace(/\n/g, '\n> ')}\n\n---\n\n${output}`;
                    }
                    const dynamicActiveFile = this.app.workspace.getActiveFile();
                    await this.handleInsertion(output, dynamicActiveFile);
                });
            insertBtn.buttonEl.style.width = '100%';
        }
    }

    private async executeAI() {
        this.isProcessing = true;
        this.usedPromptText = this.promptText;

        let targetContent = '';

        if (this.activeTab === 'multi-source') {
            if (this.sources.length === 0) {
                new Notice('분석할 소스가 없습니다. 패널에서 소스를 추가해 주세요.');
                this.isProcessing = false;
                return;
            }
            // 모든 소스들을 마크다운 형식으로 병합
            targetContent = this.sources.map((s, idx) => `### Source [${idx + 1}]: ${s.title}\n${s.content}\n`).join('\n---\n');
        } else if (this.activeTab === 'note-agent') {
            // Note Agent 탭 전용 실행 로직
            await this.executeNoteAgentFeature();
            return;
        } else {
            // 기존 단일 파일/선택영역 모드
            // 1. 현재 에디터 내용 혹은 노트 내용 가져오기
            const activeFile = this.app.workspace.getActiveFile();
            
            // 사이드바 포커스 시 getActiveViewOfType가 null일 수 있으므로 우회 탐색
            let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView && activeFile) {
                const leaves = this.app.workspace.getLeavesOfType("markdown");
                const leaf = leaves.find(l => (l.view as MarkdownView).file?.path === activeFile.path);
                if (leaf) activeView = leaf.view as MarkdownView;
            }

            if (activeView && (activeView as any).editor) {
                targetContent = (activeView as any).editor.getSelection();
            }

            if (!targetContent && activeFile) {
                targetContent = await this.app.vault.read(activeFile);
            }

            if (!targetContent.trim()) {
                new Notice('참조할 내용(선택된 텍스트 혹은 노트 내용)이 발견되지 않았습니다. 기본 상태에서 메타 분석을 시작합니다.');
            }
        }

        // 프롬프트 구성
        const languageInstruction = this.outputLanguage !== 'Auto'
            ? `\n\n[중요 지침] 반드시 다음 언어로 답변을 작성하세요: **${this.outputLanguage}**`
            : '';

        const finalPrompt = (this.promptText.includes('{{content}}')
            ? this.promptText.replace('{{content}}', targetContent)
            : `${this.promptText}\n\n${targetContent}`) + languageInstruction;

        // this.close(); // 요청 시작 시 모달 닫기 - REMOVED

        await withProgressModal(this.app, 'AI 템플릿 처리 중...', async (progressModal) => {
            try {
                progressModal.updateProgress(10, '요청을 준비 중입니다...');

                const result = await this.plugin.connectionAnalyzer.generateQuickDraft(finalPrompt);
                progressModal.updateProgress(90, '결과 렌더링 중...');

                this.aiOutput = result.content;
                this.viewMode = 'result';

                new Notice(`분석 완료 (비용: $${result.cost.toFixed(4)})`);
                progressModal.complete(`완료 (비용: $${result.cost.toFixed(4)})`);

                // 모달 데이터를 갱신 (결과 미리보기)
                this.onOpen();
            } catch (error) {
                console.error('AI Assistant Error:', error);
                const msg = `오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
                new Notice(msg);
                progressModal.setError(msg);
            } finally {
                this.isProcessing = false;
            }
        });
    }

    private async handleInsertion(output: string, activeFile: TFile | null, forceNewNote: boolean = false) {
        const mode = forceNewNote ? 'new-note' : this.insertionMode;

        if (mode === 'new-note') {
            const firstLine = output.split('\n')[0];
            let title = firstLine.replace(/^#*\s*/, '').trim();
            title = title.replace(/[\\/:*?"<>|]/g, ''); // Sanitize

            if (!title) {
                title = `AI Assistant ${new Date().toISOString().slice(0, 10)}`;
            }

            const fileName = `${title}.md`;
            let fileToOpen = await this.app.vault.create(fileName, output);
            this.app.workspace.openLinkText(fileToOpen.path, '', true);

        } else if (mode === 'cursor') {
            let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView && activeFile) {
                const leaves = this.app.workspace.getLeavesOfType("markdown");
                const leaf = leaves.find(l => (l.view as MarkdownView).file?.path === activeFile.path);
                if (leaf) activeView = leaf.view as MarkdownView;
            }

            if (activeView && (activeView as any).editor) {
                const cursor = (activeView as any).editor.getCursor();
                (activeView as any).editor.replaceRange(`\n\n${output}\n\n`, cursor);
            } else {
                new Notice('현재 활성화된 에디터가 없습니다. 새 노트로 생성합니다.');
                await this.handleInsertion(output, null, true); // Fallback to new note
            }

        } else if (mode === 'end-of-note') {
            if (activeFile) {
                const content = await this.app.vault.read(activeFile);
                await this.app.vault.modify(activeFile, content + `\n\n---\n\n## AI Analysis\n\n${output}\n`);
            } else {
                new Notice('현재 활성화된 노트가 없습니다. 새 노트로 생성합니다.');
                await this.handleInsertion(output, null, true); // Fallback to new note
            }
        }
    }

    private async executeNoteAgentFeature() {
        const feature = this.noteAgentFeature;

        if (feature === 'analyze') {
            const file = this.app.workspace.getActiveFile();
            if (!file || file.extension !== 'md') {
                new Notice('활성화된 마크다운 노트가 없습니다.');
                this.isProcessing = false;
                return;
            }
            await withProgressModal(this.app, '연결 분석 중...', async (progressModal) => {
                try {
                    progressModal.updateProgress(30, '관련 노트 찾는 중...');
                    const result = await this.plugin.connectionAnalyzer.analyzeNote(file);
                    progressModal.updateProgress(90, '결과 렌더링 중...');

                    // 결과를 텍스트로 변환
                    let output = `# 분석 결과: ${file.basename}\n\n`;
                    if (result.connections.length > 0) {
                        output += `## 🔗 발견된 연결\n`;
                        for (const conn of result.connections) {
                            output += `- **[[${conn.targetPath}]]** (${(conn.confidence * 100).toFixed(0)}%) - ${conn.reasoning}\n`;
                        }
                        output += '\n';
                    }
                    if (result.gaps.length > 0) {
                        output += `## 🔍 지식 갭\n`;
                        for (const gap of result.gaps) {
                            output += `- **${gap.topic}**: ${gap.description}\n`;
                        }
                        output += '\n';
                    }
                    if (result.insights) {
                        output += `## 💡 인사이트\n${result.insights}\n`;
                    }
                    output += `\n> 💰 분석 비용: $${result.cost.toFixed(4)}`;

                    this.aiOutput = output;
                    this.viewMode = 'result';
                    new Notice(`분석 완료 (비용: $${result.cost.toFixed(4)})`);
                    progressModal.complete(`완료 (비용: $${result.cost.toFixed(4)})`);
                    this.onOpen();
                } catch (error) {
                    const msg = `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
                    new Notice(msg);
                    progressModal.setError(msg);
                } finally {
                    this.isProcessing = false;
                }
            });
        } else if (feature === 'quick-draft') {
            if (!this.promptText.trim()) {
                new Notice('작성 요청을 입력해주세요.');
                this.isProcessing = false;
                return;
            }
            await withProgressModal(this.app, '빠른 초안 생성 중...', async (progressModal) => {
                try {
                    progressModal.updateProgress(30, 'AI 생성 중...');
                    const result = await this.plugin.connectionAnalyzer.generateQuickDraft(this.promptText);
                    progressModal.updateProgress(90, '결과 렌더링 중...');
                    this.aiOutput = result.content;
                    this.viewMode = 'result';
                    new Notice(`생성 완료 (비용: $${result.cost.toFixed(4)})`);
                    progressModal.complete(`완료 (비용: $${result.cost.toFixed(4)})`);
                    this.onOpen();
                } catch (error) {
                    const msg = `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
                    new Notice(msg);
                    progressModal.setError(msg);
                } finally {
                    this.isProcessing = false;
                }
            });
        } else if (feature === 'similar') {
            const file = this.app.workspace.getActiveFile();
            if (!file || file.extension !== 'md') {
                new Notice('활성화된 마크다운 노트가 없습니다.');
                this.isProcessing = false;
                return;
            }
            await withProgressModal(this.app, '유사 노트 검색 중...', async (progressModal) => {
                try {
                    progressModal.updateProgress(30, '임베딩 검색 중...');
                    const content = await this.app.vault.read(file);
                    const similar = await this.plugin.embeddingService.searchByQuery(content, 10);
                    progressModal.updateProgress(90, '결과 렌더링 중...');

                    let output = `# 유사 노트: ${file.basename}\n\n`;
                    if (similar.length === 0) {
                        output += '유사한 노트를 찾을 수 없습니다. 먼저 인덱싱을 실행해주세요.';
                    } else {
                        output += '| # | 노트 | 유사도 |\n|---|------|--------|\n';
                        similar.forEach((n, i) => {
                            output += `| ${i + 1} | [[${n.title}]] | ${(n.similarity * 100).toFixed(1)}% |\n`;
                        });
                    }

                    this.aiOutput = output;
                    this.viewMode = 'result';
                    new Notice(`유사 노트 ${similar.length}개 발견`);
                    progressModal.complete(`완료: ${similar.length}개 발견`);
                    this.onOpen();
                } catch (error) {
                    const msg = `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
                    new Notice(msg);
                    progressModal.setError(msg);
                } finally {
                    this.isProcessing = false;
                }
            });
        } else {
            this.isProcessing = false;
        }
    }

    async onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
