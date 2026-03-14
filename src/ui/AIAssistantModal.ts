import { App, Modal, Setting, Notice, TextAreaComponent, DropdownComponent, ButtonComponent, TFile, MarkdownView } from 'obsidian';
import { withProgressModal } from './progress-modal';
import OSBAPlugin from '../main';
import { ANALYSIS_TEMPLATES, TemplateType, getTemplateById, renderPrompt } from '../core/templates';
import { InsertionMode, SavedPrompt, SourceItem, MultiSourceAnalysisType } from '../types';
import { FileSuggestModal, TextInputModal } from './MultiSourceModals';
import { PromptEditModal } from './PromptEditModal';

export class AIAssistantModal extends Modal {
    private plugin: OSBAPlugin;

    // UI State
    private activeTab: 'easy-gate' | 'stargate' | 'custom' | 'multi-source' = 'easy-gate';
    private selectedTemplateId: string | null = null;
    private customPromptId: string | null = null;
    private promptText: string = '';
    private insertionMode: InsertionMode;
    private outputLanguage: string;
    private isProcessing: boolean = false;

    // Multi-source State
    private sources: SourceItem[] = [];
    private multiSourceType: MultiSourceAnalysisType = 'synthesis';

    // Preview / Result State
    private viewMode: 'prompt' | 'result' = 'prompt';
    private aiOutput: string = '';
    private activeFileAtOpen: TFile | null = null;

    // UI Elements
    private contentContainer!: HTMLElement;
    private previewTextArea!: TextAreaComponent;

    constructor(app: App, plugin: OSBAPlugin) {
        super(app);
        this.plugin = plugin;
        this.insertionMode = this.plugin.settings.defaultInsertionMode || 'new-note';
        this.outputLanguage = this.plugin.settings.defaultOutputLanguage || 'Auto';
        this.activeFileAtOpen = this.app.workspace.getActiveFile();

        // Default to first easy-gate template
        this.selectedTemplateId = 'basic-summary';
        this.updatePreviewText();

        // Auto-add current file to multi-source if available
        if (this.activeFileAtOpen) {
            this.addActiveNoteToSources(this.activeFileAtOpen);
        }
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

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('osba-modal');
        contentEl.addClass('ai-assistant-modal');

        // 모달 넓게
        this.modalEl.style.width = '700px';
        this.modalEl.style.maxWidth = '90vw';

        // 헤더
        contentEl.createEl('h2', { text: '✨ AI 템플릿 마법사' });
        contentEl.createEl('p', {
            text: '다양한 템플릿을 선택하거나 직접 프롬프트를 작성하여 노트를 생성/수정하세요.',
            cls: 'osba-modal-desc',
        });

        // 메인 레이아웃 (왼쪽 탭/옵션, 오른쪽 미리보기)
        const mainContainer = contentEl.createDiv({ cls: 'assistant-main-container' });
        mainContainer.style.cssText = 'display: flex; gap: 20px; align-items: flex-start;';

        const leftPanel = mainContainer.createDiv({ cls: 'assistant-left-panel' });
        leftPanel.style.cssText = 'flex: 1;';

        const rightPanel = mainContainer.createDiv({ cls: 'assistant-right-panel' });
        rightPanel.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 10px;';

        this.renderTabs(leftPanel);

        this.contentContainer = leftPanel.createDiv({ cls: 'assistant-tab-content' });
        this.contentContainer.style.cssText = 'min-height: 250px; padding: 10px 0;';

        this.renderTabContent();

        this.renderRightPanel(rightPanel);

        this.renderFooter(contentEl);
    }

    private renderTabs(container: HTMLElement) {
        const tabContainer = container.createDiv({ cls: 'osba-tabs' });
        tabContainer.style.cssText = 'display: flex; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 15px;';

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

                // 프롬프트 강제 동기화 (커스텀 탭 및 멀티소스 탭이 아닌경우)
                if (id !== 'custom' && id !== 'multi-source') this.updatePreviewText();

                this.onOpen(); // 다시 렌더링
            };
        };

        createTab('easy-gate', 'Easy Gate (기본)');
        createTab('stargate', 'Stargate (심층)');
        createTab('custom', 'Custom (커스텀)');
        createTab('multi-source', 'Multi-Source (멀티 소스)');
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
        }
    }

    private renderMultiSourceTypeList(container: HTMLElement) {
        container.createEl('h3', { text: '멀티 소스 분석 유형' }).style.margin = '0 0 10px 0';

        const types: { id: MultiSourceAnalysisType; label: string; desc: string }[] = [
            { id: 'synthesis', label: '종합 분석', desc: '모든 소스를 융합하여 요약' },
            { id: 'basic', label: '기본 분석', desc: '소스간 핵심 내용 비교 분석' },
            { id: 'summary', label: '개별 요약', desc: '각 소스 요약 후 종합' },
            { id: 'custom', label: '커스텀 분석', desc: '직접 작성한 지시사항 적용' },
        ];

        const listDiv = container.createDiv();
        listDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        types.forEach(type => {
            const row = listDiv.createDiv();
            row.style.cssText = `
                padding: 10px; 
                border-radius: 6px; 
                cursor: pointer; 
                border: 1px solid ${this.multiSourceType === type.id ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                background: ${this.multiSourceType === type.id ? 'var(--background-modifier-hover)' : 'transparent'};
                transition: all 0.2s ease-in-out;
            `;

            row.createDiv({ text: type.label, cls: 'template-name' }).style.cssText = 'font-weight: bold; margin-bottom: 4px;';
            row.createDiv({ text: type.desc, cls: 'template-desc' }).style.cssText = 'font-size: 12px; color: var(--text-muted);';

            row.onclick = () => {
                this.multiSourceType = type.id;
                this.updateMultiSourcePrompt();
                this.onOpen();
            };
        });
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
        grid.style.cssText = 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;';

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
            this.plugin.settings.savedPrompts.forEach((savedPrompt: SavedPrompt) => {
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

                const textDiv = item.createDiv();
                textDiv.style.cssText = 'flex: 1; min-width: 0;';
                textDiv.createDiv({ text: `💬 ${savedPrompt.name}` }).style.fontWeight = '500';
                if (savedPrompt.description) {
                    textDiv.createDiv({ text: savedPrompt.description }).style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 2px;';
                }

                const btnGroup = item.createDiv();
                btnGroup.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

                const applyBtn = btnGroup.createEl('button', { text: '적용' });
                applyBtn.style.fontSize = '12px';
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.customPromptId = savedPrompt.id;
                    this.promptText = savedPrompt.prompt;
                    this.selectedTemplateId = 'custom';
                    this.onOpen();
                };

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

        const isPromptMode = this.viewMode === 'prompt';
        const headerText = isPromptMode ? '👁️ 프롬프트 미리보기' : '✨ AI 생성 결과 (편집 가능)';
        container.createEl('h3', { text: headerText }).style.margin = '0 0 5px 0';

        if (!isPromptMode) {
            container.createEl('p', {
                text: '아래 텍스트를 직접 수정한 뒤 원하는 노트 위치에 삽입할 수 있습니다.',
                cls: 'osba-modal-desc',
            }).style.margin = '0 0 10px 0';
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
                            prompt: promptBody
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
                            id: `custom-${Date.now()}`,
                            name,
                            description: description || undefined,
                            prompt: promptBody
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
        footerInfo.style.cssText = 'margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center;';

        const languageGroup = footerInfo.createDiv();
        languageGroup.style.display = 'flex';
        languageGroup.style.alignItems = 'center';
        languageGroup.style.gap = '10px';
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

        const insertOptionsGroup = footerInfo.createDiv();
        insertOptionsGroup.style.display = 'flex';
        insertOptionsGroup.style.alignItems = 'center';
        insertOptionsGroup.style.gap = '10px';

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

        const actionGroup = footerInfo.createDiv();
        actionGroup.style.display = 'flex';
        actionGroup.style.gap = '10px';

        if (this.viewMode === 'prompt') {
            new ButtonComponent(actionGroup)
                .setButtonText('취소')
                .onClick(() => this.close());

            new ButtonComponent(actionGroup)
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
        } else {
            new ButtonComponent(actionGroup)
                .setButtonText('🔙 이전으로')
                .onClick(() => {
                    this.viewMode = 'prompt';
                    this.onOpen();
                });

            new ButtonComponent(actionGroup)
                .setButtonText('📥 결과 삽입하기')
                .setCta()
                .onClick(async () => {
                    this.close();
                    await this.handleInsertion(this.aiOutput, this.activeFileAtOpen);
                });
        }
    }

    private async executeAI() {
        this.isProcessing = true;

        let targetContent = '';

        if (this.activeTab === 'multi-source') {
            if (this.sources.length === 0) {
                new Notice('분석할 소스가 없습니다. 패널에서 소스를 추가해 주세요.');
                this.isProcessing = false;
                return;
            }
            // 모든 소스들을 마크다운 형식으로 병합
            targetContent = this.sources.map((s, idx) => `### Source [${idx + 1}]: ${s.title}\n${s.content}\n`).join('\n---\n');
        } else {
            // 기존 단일 파일/선택영역 모드
            // 1. 현재 에디터 내용 혹은 노트 내용 가져오기
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            const activeFile = this.app.workspace.getActiveFile();

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

    private async handleInsertion(output: string, activeFile: TFile | null) {
        if (this.insertionMode === 'new-note') {
            const firstLine = output.split('\n')[0];
            let title = firstLine.replace(/^#*\s*/, '').trim();
            title = title.replace(/[\\/:*?"<>|]/g, ''); // Sanitize

            if (!title) {
                title = `AI Assistant ${new Date().toISOString().slice(0, 10)}`;
            }

            const fileName = `${title}.md`;
            let fileToOpen = await this.app.vault.create(fileName, output);
            this.app.workspace.openLinkText(fileToOpen.path, '', true);

        } else if (this.insertionMode === 'cursor') {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

            if (activeView && (activeView as any).editor) {
                const cursor = (activeView as any).editor.getCursor();
                (activeView as any).editor.replaceRange(`\n\n${output}\n\n`, cursor);
            } else {
                new Notice('현재 활성화된 에디터가 없습니다. 새 노트로 생성합니다.');
                await this.handleInsertion(output, null); // Fallback
            }

        } else if (this.insertionMode === 'end-of-note') {
            if (activeFile) {
                const content = await this.app.vault.read(activeFile);
                await this.app.vault.modify(activeFile, content + `\n\n---\n\n## AI Analysis\n\n${output}\n`);
            } else {
                new Notice('현재 활성화된 노트가 없습니다. 새 노트로 생성합니다.');
                await this.handleInsertion(output, null); // Fallback
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
