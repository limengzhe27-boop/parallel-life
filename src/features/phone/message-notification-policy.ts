/** Server-projected origin is independent of when a message was written or first read. */
export type MessageNotificationState = {
  role?: 'user' | 'assistant';
  initialRead?: boolean;
  origin?: 'fictional_history' | 'publication_preset' | 'recall';
  recalled?: boolean;
  text?: string;
  stickerId?: string;
  photoId?: string;
  attachment?: unknown;
  mediaStatus?: string;
  photo?: { status?: string };
};

/** Authored phone contents remain in chat but are not newly delivered runtime activity. */
export function isIncomingRuntimeMessage(message: MessageNotificationState): boolean {
  return (
    message.role !== 'user' &&
    message.initialRead !== true &&
    message.origin !== 'fictional_history' &&
    message.origin !== 'publication_preset' &&
    message.origin !== 'recall' &&
    message.recalled !== true &&
    message.text?.trim() !== '[[recall:last]]' &&
    !(
      !message.text?.trim() &&
      !message.stickerId &&
      !message.photoId &&
      !message.attachment &&
      (message.mediaStatus === 'pending' ||
        message.mediaStatus === 'failed' ||
        (message.photo?.status !== undefined && message.photo.status !== 'ready'))
    )
  );
}
