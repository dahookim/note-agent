/**
 * Progress Modal
 * 액션 실행 시 진행 상황을 표시하는 모달
 */

import { App, Modal } from 'obsidian';

export interface ProgressState {
  status: 'running' | 'completed' | 'error' | 'cancelled';
  progress: number; // 0-100
  message: string;
  subMessage?: string;
  error?: string;
}

export class ProgressModal extends Modal {
  private title: string;
  private state: ProgressState;
  private progressBarEl: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;
  private subMessageEl: HTMLElement | null = null;
  private statusIconEl: HTMLElement | null = null;
  private cancelCallback: (() => void) | null = null;
  private closeButton: HTMLButtonElement | null = null;

  constructor(app: App, title: string) {
    super(app);
    this.title = title;
    this.state = {
      status: 'running',
      progress: 0,
      message: '준비 중...',
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('osba-progress-modal');

    // 타이틀
    const titleEl = contentEl.createEl('h2', {
      cls: 'osba-progress-title'
    });

    this.statusIconEl = titleEl.createSpan({ cls: 'osba-progress-icon' });
    titleEl.createSpan({ text: this.title });

    // 진행률 바 컨테이너
    const progressContainer = contentEl.createDiv({ cls: 'osba-progress-container' });

    const progressTrack = progressContainer.createDiv({ cls: 'osba-progress-track' });
    this.progressBarEl = progressTrack.createDiv({ cls: 'osba-progress-bar' });

    this.progressTextEl = progressContainer.createDiv({ cls: 'osba-progress-text' });

    // 메시지 영역
    this.messageEl = contentEl.createDiv({ cls: 'osba-progress-message' });
    this.subMessageEl = contentEl.createDiv({ cls: 'osba-progress-submessage' });

    // 버튼 영역
    const buttonContainer = contentEl.createDiv({ cls: 'osba-progress-buttons' });

    // 취소 버튼 (실행 중일 때만)
    if (this.cancelCallback) {
      const cancelBtn = buttonContainer.createEl('button', {
        text: '취소',
        cls: 'osba-btn osba-btn-cancel',
      });
      cancelBtn.onclick = () => {
        if (this.cancelCallback) {
          this.cancelCallback();
        }
        this.updateState({ status: 'cancelled', message: '작업이 취소되었습니다.' });
      };
    }

    // 닫기 버튼
    this.closeButton = buttonContainer.createEl('button', {
      text: '닫기',
      cls: 'osba-btn osba-btn-close',
    });
    this.closeButton.onclick = () => this.close();
    this.closeButton.style.display = 'none'; // 처음에는 숨김

    // 초기 상태 렌더링
    this.render();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * 취소 콜백 설정
   */
  setCancelCallback(callback: () => void): this {
    this.cancelCallback = callback;
    return this;
  }

  /**
   * 상태 업데이트
   */
  updateState(update: Partial<ProgressState>): void {
    this.state = { ...this.state, ...update };
    this.render();
  }

  /**
   * 진행률만 업데이트 (빠른 업데이트용)
   */
  updateProgress(progress: number, message?: string): void {
    this.state.progress = Math.min(100, Math.max(0, progress));
    if (message) {
      this.state.message = message;
    }
    this.render();
  }

  /**
   * 완료 상태로 전환
   */
  complete(message: string = '완료되었습니다!'): void {
    this.updateState({
      status: 'completed',
      progress: 100,
      message,
    });
  }

  /**
   * 에러 상태로 전환
   */
  setError(error: string): void {
    this.updateState({
      status: 'error',
      message: '오류가 발생했습니다',
      error,
    });
  }

  /**
   * UI 렌더링
   */
  private render(): void {
    if (!this.progressBarEl || !this.progressTextEl || !this.messageEl) return;

    // 진행률 바
    this.progressBarEl.style.width = `${this.state.progress}%`;

    // 상태별 클래스
    this.progressBarEl.removeClass('running', 'completed', 'error', 'cancelled');
    this.progressBarEl.addClass(this.state.status);

    // 진행률 텍스트
    this.progressTextEl.setText(`${Math.round(this.state.progress)}%`);

    // 상태 아이콘
    if (this.statusIconEl) {
      switch (this.state.status) {
        case 'running':
          this.statusIconEl.setText('⏳');
          break;
        case 'completed':
          this.statusIconEl.setText('✅');
          break;
        case 'error':
          this.statusIconEl.setText('❌');
          break;
        case 'cancelled':
          this.statusIconEl.setText('🚫');
          break;
      }
    }

    // 메시지
    this.messageEl.setText(this.state.message);

    // 서브 메시지
    if (this.subMessageEl) {
      if (this.state.subMessage) {
        this.subMessageEl.setText(this.state.subMessage);
        this.subMessageEl.style.display = 'block';
      } else if (this.state.error) {
        this.subMessageEl.setText(this.state.error);
        this.subMessageEl.addClass('osba-error-text');
        this.subMessageEl.style.display = 'block';
      } else {
        this.subMessageEl.style.display = 'none';
      }
    }

    // 완료/에러 시 닫기 버튼 표시
    if (this.closeButton) {
      if (this.state.status !== 'running') {
        this.closeButton.style.display = 'block';
      }
    }
  }
}

/**
 * 간단한 진행 상황 표시용 헬퍼 함수
 */
export async function withProgressModal<T>(
  app: App,
  title: string,
  task: (modal: ProgressModal) => Promise<T>
): Promise<T> {
  const modal = new ProgressModal(app, title);
  modal.open();

  try {
    const result = await task(modal);
    modal.complete();

    // 2초 후 자동 닫기
    setTimeout(() => modal.close(), 2000);

    return result;
  } catch (error) {
    modal.setError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
