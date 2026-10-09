export type PhotoOperation = 'idle' | 'uploading' | 'saving' | 'sending';

export function photoDisplayState(input: {
  operation: PhotoOperation;
  pendingAssetId: string | null;
  error: string;
  info?: string;
  saved: boolean;
}): { kind: 'progress' | 'pending' | 'error'; text: string; actions: boolean } | null {
  if (input.operation !== 'idle') {
    const text =
      input.operation === 'uploading'
        ? '正在上传照片…'
        : input.operation === 'saving'
          ? '正在保存照片引用…'
          : input.saved
            ? '照片已发出，正在等回应…'
            : '正在确认照片消息…';
    return { kind: 'progress', text, actions: false };
  }
  if (input.error)
    return { kind: 'error', text: input.error, actions: Boolean(input.pendingAssetId) };
  if (input.info) return { kind: 'pending', text: input.info, actions: false };
  if (input.pendingAssetId && !input.saved)
    return { kind: 'pending', text: '这张照片的发送结果待核对。', actions: true };
  return null;
}

export function shouldSubmitComposerKey(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.isComposing && input.keyCode !== 229;
}

/** Clear/restore only the caption that started a photo send. Newer typing wins. */
export function restoreCaptionIfUntouched(currentDraft: string, caption: string): string {
  return currentDraft.length === 0 ? caption : currentDraft;
}
