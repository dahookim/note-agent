import { App, Modal, Setting, Notice, TextAreaComponent, DropdownComponent, ButtonComponent, TFile, MarkdownView } from 'obsidian';
import OSBAPlugin from '../main';
import { ANALYSIS_TEMPLATES, TemplateType, getTemplateById, renderPrompt } from '../core/templates';
import { InsertionMode, SavedPrompt } from '../types';

export class AIAssistantModal extends Modal {
    private plugin: OSBAPlugin;

    // UI State
    private activeTab: 'easy-gate' | 'stargate' | 'custom' = 'easy-gate';
    private selectedTemplateId: string | null = null;
    private customPromptId: string | null = null;
    private promptText: string = '';
    private insertionMode: InsertionMode;
    private isProcessing: boolean = false;

    // UI Elements
    private contentContainer!: HTMLElement;
    private previewTextArea!: TextAreaComponent;

    constructor(app: App, plugin: OSBAPlugin) {
        super(app);
        this.plugin = plugin;
        this.insertionMode = this.plugin.settings.defaultInsertionMode || 'new-note';

        // Default to first easy-gate template
        this.selectedTemplateId = 'basic-summary';
        this.updatePreviewText();
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

                // 각 탭별 기본 선택
                if (id === 'easy-gate') this.selectedTemplateId = 'basic-summary';
                else if (id === 'stargate') this.selectedTemplateId = 'briefing';

                // 프롬프트 강제 동기화 (커스텀 탭이 아닌경우)
                if (id !== 'custom') this.updatePreviewText();

                this.onOpen(); // 다시 렌더링
            };
        };

        createTab('easy-gate', 'Easy Gate (기본)');
        createTab('stargate', 'Stargate (심층)');
        createTab('custom', 'Custom (커스텀)');
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
            this.plugin.settings.savedPrompts.forEach((prompt: SavedPrompt) => {
                const item = listContainer.createDiv();
                item.style.cssText = `
                    display: flex; justify-content: space-between; align-items: center; 
                    padding: 8px 12px; border: 1px solid var(--background-modifier-border); 
                    border-radius: 6px; cursor: pointer;
                `;

                if (this.customPromptId === prompt.id) {
                    item.style.borderColor = 'var(--interactive-accent)';
                    item.style.background = 'var(--background-secondary)';
                }

                item.createSpan({ text: `💬 ${prompt.name}`, cls: 'prompt-title' });

                const btnGroup = item.createDiv();
                btnGroup.style.display = 'flex';
                btnGroup.style.gap = '4px';

                const applyBtn = btnGroup.createEl('button', { text: '적용' });
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.customPromptId = prompt.id;
                    this.promptText = prompt.prompt;
                    this.selectedTemplateId = 'custom';
                    this.onOpen();
                };

                const delBtn = btnGroup.createEl('button', { text: '삭제' });
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`'${prompt.name}' 프롬프트를 삭제하시겠습니까?`)) {
                        this.plugin.settings.savedPrompts = this.plugin.settings.savedPrompts.filter((p: SavedPrompt) => p.id !== prompt.id);
                        await this.plugin.saveSettings();
                        if (this.customPromptId === prompt.id) {
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
        container.createEl('h3', { text: '👁️ 프롬프트 미리보기' }).style.margin = '0 0 5px 0';

        const isCustom = this.activeTab === 'custom';

        const textAreaSetting = new Setting(container)
            .setClass('assistant-preview-setting')
            .addTextArea(text => {
                this.previewTextArea = text;
                text.setValue(this.promptText);
                text.inputEl.style.cssText = `
                    width: 100%;
                    min-height: 180px;
                    resize: vertical;
                    font-size: 13px;
                `;

                if (!isCustom) {
                    text.setDisabled(true); // Default 템플릿들은 읽기 전용
                } else {
                    text.setPlaceholder('커스텀 프롬프트를 작성하세요...');
                    text.onChange(value => {
                        this.promptText = value;
                    });
                }
            });

        textAreaSetting.settingEl.style.border = 'none';
        textAreaSetting.settingEl.style.padding = '0';

        // "Custom" 탭이고 현재 작성중인 프롬프트가 있으면 저장 버튼 스니펫 
        if (isCustom) {
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
                        // 기존 프롬프트 업데이트
                        const existing = this.plugin.settings.savedPrompts.find((p: SavedPrompt) => p.id === this.customPromptId);
                        if (existing) {
                            existing.prompt = this.promptText;
                            await this.plugin.saveSettings();
                            new Notice('프롬프트가 수정되었습니다.');
                            this.onOpen();
                            return;
                        }
                    }

                    // 새 프롬프트
                    const name = prompt('프롬프트 이름을 입력하세요:');
                    if (name) {
                        const newPrompt: SavedPrompt = {
                            id: `custom-${Date.now()}`,
                            name,
                            prompt: this.promptText
                        };
                        if (!this.plugin.settings.savedPrompts) {
                            this.plugin.settings.savedPrompts = [];
                        }
                        this.plugin.settings.savedPrompts.push(newPrompt);
                        await this.plugin.saveSettings();
                        this.customPromptId = newPrompt.id;
                        new Notice('새 프롬프트가 저장되었습니다.');
                        this.onOpen();
                    }
                });
        }
    }

    private renderFooter(container: HTMLElement) {
        const footerInfo = container.createDiv();
        footerInfo.style.cssText = 'margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center;';

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

        new ButtonComponent(actionGroup)
            .setButtonText('취소')
            .onClick(() => this.close());

        new ButtonComponent(actionGroup)
            .setButtonText('🚀 실행하기')
            .setCta()
            .onClick(async () => {
                if (!this.promptText || this.promptText.trim() === '') {
                    new Notice('프롬프트가 비어있습니다.');
                    return;
                }

                if (this.isProcessing) return;

                await this.executeAI();
            });
    }

    private async executeAI() {
        this.isProcessing = true;

        let targetContent = '';

        // 1. 현재 에디터 내용 혹은 노트 내용 가져오기
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        const activeFile = this.app.workspace.getActiveFile();

        if (activeView && (activeView as any).editor) {
            // 선택된 텍스트가 있으면 그것을 컨텍스트로 사용
            targetContent = (activeView as any).editor.getSelection();
        }

        if (!targetContent && activeFile) {
            // 선택 내역이 없으면 현재 파일 전체 내용 읽기
            targetContent = await this.app.vault.read(activeFile);
        }

        if (!targetContent.trim()) {
            new Notice('참조할 내용(선택된 텍스트 혹은 노트 내용)이 발견되지 않았습니다. 백지 상태에서 시작합니다.');
        }

        // 프롬프트 구성
        // {{content}} 치환
        const finalPrompt = this.promptText.includes('{{content}}')
            ? this.promptText.replace('{{content}}', targetContent)
            : `${this.promptText}\n\n${targetContent}`;

        new Notice('AI 분석 요청중...');
        this.close(); // 요청 시작 시 모달 닫기

        try {
            // connectionAnalyzer에 임시로 넣거나, ProviderManager를 직접 호출
            // QuickDraft 로직 재사용 (이후 리팩토링 가능)
            const result = await this.plugin.connectionAnalyzer.generateQuickDraft(finalPrompt);
            const output = result.content;

            await this.handleInsertion(output, activeFile);
            new Notice(`분석 완료 (비용: $${result.cost.toFixed(4)})`);

        } catch (error) {
            console.error('AI Assistant Error:', error);
            new Notice(`오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        } finally {
            this.isProcessing = false;
        }
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
