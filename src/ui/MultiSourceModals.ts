import { App, Modal, Setting, TFile, FuzzySuggestModal, Notice } from 'obsidian';

// ============================================
// 파일 선택 모달
// ============================================

export class FileSuggestModal extends FuzzySuggestModal<TFile> {
    private onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder('노트 파일을 검색하세요...');
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile): void {
        this.onSelect(item);
    }
}

// ============================================
// 텍스트 입력 모달
// ============================================

export class TextInputModal extends Modal {
    private onSubmit: (title: string, content: string) => void;
    private titleInput: string = '';
    private contentInput: string = '';

    constructor(app: App, onSubmit: (title: string, content: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('osba-text-input-modal');

        contentEl.createEl('h2', { text: '✏️ 텍스트 직접 입력' });

        // 제목 입력
        new Setting(contentEl)
            .setName('제목')
            .setDesc('이 텍스트의 제목을 입력하세요')
            .addText(text => {
                text.setPlaceholder('예: 회의록 요약');
                text.onChange(value => {
                    this.titleInput = value;
                });
            });

        // 콘텐츠 입력
        const contentSection = contentEl.createDiv({ cls: 'content-input-section' });
        contentSection.style.marginTop = '15px';
        contentSection.createEl('label', { text: '내용' }).style.fontWeight = 'bold';

        const textArea = contentSection.createEl('textarea', {
            placeholder: '분석할 텍스트를 여기에 입력하거나 붙여넣으세요...'
        });
        textArea.style.cssText = `
            width: 100%;
            min-height: 200px;
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
            this.contentInput = (e.target as HTMLTextAreaElement).value;
        };

        // 버튼
        const buttonRow = contentEl.createDiv({ cls: 'button-row' });
        buttonRow.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 16px;
        `;

        const cancelBtn = buttonRow.createEl('button', { text: '취소' });
        cancelBtn.onclick = () => this.close();

        const addBtn = buttonRow.createEl('button', { text: '➕ 추가', cls: 'mod-cta' });
        addBtn.onclick = () => {
            if (!this.titleInput.trim()) {
                new Notice('제목을 입력해주세요.');
                return;
            }
            if (!this.contentInput.trim()) {
                new Notice('내용을 입력해주세요.');
                return;
            }
            this.onSubmit(this.titleInput.trim(), this.contentInput.trim());
            this.close();
        };
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
