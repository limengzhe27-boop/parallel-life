import type { PhoneApp } from '../navigation.ts';
/** Display models only. The integration adapter owns authorization, storage and task polling. */
export type PhoneLink = { app: PhoneApp; target: string; label: string };
export type PhoneContact = {
  id: string;
  name: string;
  relationship: string;
  summary?: string;
  avatarUrl?: string;
  unread: number;
};
export type PhoneMessage = {
  id: string;
  actorId: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  status: 'pending' | 'sent' | 'failed' | 'unknown';
  links?: PhoneLink[];
};
export type PhonePhoto = {
  id: string;
  date: string;
  title: string;
  description: string;
  url?: string;
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'unknown';
  links?: PhoneLink[];
};
export type PhoneInvitation = {
  id: string;
  title: string;
  at: string;
  participantIds: string[];
  status: 'proposed' | 'confirmed' | 'cancelled';
  version: number;
  links?: PhoneLink[];
};
export type PhoneNote = {
  id: string;
  title: string;
  text: string;
  version: number;
  updatedAt: string;
  links?: PhoneLink[];
};
export type PhoneAppsData = {
  contacts: readonly PhoneContact[];
  messages: readonly PhoneMessage[];
  photos: readonly PhonePhoto[];
  invitations: readonly PhoneInvitation[];
  notes: readonly PhoneNote[];
};
export type PhoneActionReceipt = { status: 'accepted' | 'committed'; taskId?: string };
export type PhoneActions = {
  uploadPhoto?: (file: File, commandId: string) => Promise<PhoneActionReceipt>;
  sendMessage?: (actorId: string, text: string, commandId: string) => Promise<PhoneActionReceipt>;
  retryMessage?: (messageId: string, commandId: string) => Promise<PhoneActionReceipt>;
  markRead?: (actorId: string) => Promise<void>;
  retryPhoto?: (photoId: string, commandId: string) => Promise<PhoneActionReceipt>;
  /** 'local' 表示便签只写本机缓存，服务端同步尚未接入，UI 必须如实说明。 */
  noteSync?: 'server' | 'local';
  saveNote?: (input: {
    id?: string;
    title: string;
    text: string;
    expectedVersion?: number;
    commandId: string;
  }) => Promise<PhoneActionReceipt>;
  changeInvitation?: (input: {
    id: string;
    operation: 'accept' | 'reschedule' | 'cancel';
    at?: string;
    expectedVersion: number;
    commandId: string;
  }) => Promise<PhoneActionReceipt>;
};

/** Terminal receipts from the adapter, keyed by the exact submitted command ID. */
export type PhoneCommandResults = Readonly<
  Record<string, { status: 'committed' | 'failed'; code?: string }>
>;
