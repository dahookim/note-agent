import { App, Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import { SavedPrompt } from '../types';

/**
 * 프롬프트 편집/생성 모달
 * 제목, 설명, 프롬프트 본문을 입력/수정
 */
export class PromptEditModal extends Modal {
    private nameValue: string;
    private descriptionValue: string;
    private promptValue: string;
    private onSubmit: (name: string, description: string, prompt: string) => void;
    private isEditMode: boolean;

    constructor(
        app: App,
        onSubmit: (name: string, description: string, prompt: string) => void,
        existing?: SavedPrompt
    ) {
        super(app);
        this.onSubmit = onSubmit;
        this.isEditMode = !!existing;
        this.nameValue = existing?.name || '';
        this.descriptionValue = existing?.description || '';
        this.promptValue = existing?.prompt || '';
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('osba-modal');

        contentEl.createEl('h2', {
            text: this.isEditMode ? '✏️ 프롬프트 편집' : '➕ 새 프롬프트 저장'
        });

        // 제목
        new Setting(contentEl)
            .setName('제목')
            .setDesc('프롬프트의 이름을 입력하세요')
            .addText(text => {
                text.setPlaceholder('예: 블로그 포스트 작성');
                text.setValue(this.nameValue);
                text.onChange(value => { this.nameValue = value; });
                text.inputEl.style.width = '100%';
            });

        // 설명
        new Setting(contentEl)
            .setName('설명 (선택사항)')
            .setDesc('프롬프트에 대한 간단한 설명')
            .addText(text => {
                text.setPlaceholder('예: SEO 최적화된 블로그 초안 생성');
                text.setValue(this.descriptionValue);
                text.onChange(value => { this.descriptionValue = value; });
                text.inputEl.style.width = '100%';
            });

        // 프롬프트 본문
        const promptSetting = new Setting(contentEl)
            .setName('프롬프트 본문')
            .setDesc('AI에게 전달할 지시사항. {{content}}를 쓰면 노트 내용으로 대체됩니다.');

        const textArea = contentEl.createEl('textarea', {
            placeholder: '프롬프트를 입력하세요...'
        });
        textArea.value = this.promptValue;
        textArea.style.cssText = `
            width: 100%;
            min-height: 150px;
            margin-top: 8px;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-primary);
            font-size: 13px;
            line-height: 1.5;
            resize: vertical;
        `;
        textArea.oninput = (e) => {
            this.promptValue = (e.target as HTMLTextAreaElement).value;
        };

        // 버튼
        const buttonRow = contentEl.createDiv();
        buttonRow.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 16px;
        `;

        new ButtonComponent(buttonRow)
            .setButtonText('취소')
            .onClick(() => this.close());

        new ButtonComponent(buttonRow)
            .setButtonText(this.isEditMode ? '💾 저장' : '➕ 추가')
            .setCta()
            .onClick(() => {
                if (!this.nameValue.trim()) {
                    new Notice('제목을 입력해주세요.');
                    return;
                }
                if (!this.promptValue.trim()) {
                    new Notice('프롬프트 본문을 입력해주세요.');
                    return;
                }
                this.onSubmit(
                    this.nameValue.trim(),
                    this.descriptionValue.trim(),
                    this.promptValue.trim()
                );
                this.close();
            });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
