import type { PhoneApp } from '../navigation.ts';
/** Display models only. The integration adapter owns authorization, storage and task polling. */
export type PhoneLink = { app: PhoneApp; target: string; label: string };
export type PhoneContact = {
  sourcePersonId?: string;
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
  photo?: PhonePhoto;
};
export type PhonePhoto = {
  sourcePersonId?: string;
  id: string;
  date: string;
  title: string;
  description: string;
  url?: string;
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'unknown';
  tag?: 'identity' | 'event' | 'upload' | 'memory';
  links?: PhoneLink[];
};
export type PhoneInvitation = {
  id: string;
  title: string;
  at: string;
  participantIds: string[];
  status: 'proposed' | 'confirmed' | 'cancelled' | 'attended' | 'missed';
  responseAt?: string;
  responseVersion?: number;
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
export type PhoneStoryChoice = {
  id: string;
  actorName: string;
  quote: string;
  intent: string;
  at: string;
  status: 'pending' | 'followed_up' | 'superseded';
  nextStep?: {
    quote: string;
    at: string;
    calendar?: {
      id: string;
      title: string;
      at: string;
      status: 'proposed' | 'confirmed' | 'cancelled' | 'attended' | 'missed';
    };
  };
  result?: {
    kind: 'reported_done' | 'blocked' | 'abandoned';
    quote: string;
    at: string;
  };
  recoveryStep?: {
    quote: string;
    at: string;
  };
};
export type PhoneAppsData = {
  contacts: readonly PhoneContact[];
  messages: readonly PhoneMessage[];
  photos: readonly PhonePhoto[];
  invitations: readonly PhoneInvitation[];
  notes: readonly PhoneNote[];
  choices?: readonly PhoneStoryChoice[];
  referenceTime?: string;
};
export type PhoneActionReceipt = { status: 'accepted' | 'committed'; taskId?: string };
export type PhoneActions = {
  enterScene?: (appointmentId: string) => Promise<PhoneActionReceipt>;
  setWallpaper?: (url: string) => void;
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
  deleteNote?: (id: string) => Promise<PhoneActionReceipt>;
  createInvitation?: (input: {
    title: string;
    at: string;
    participantIds: string[];
    notes?: string;
  }) => Promise<PhoneActionReceipt>;
  changeInvitation?: (input: {
    id: string;
    operation: 'accept' | 'reschedule' | 'cancel' | 'attend' | 'miss';
    at?: string;
    expectedVersion: number;
    commandId: string;
  }) => Promise<PhoneActionReceipt>;
};

/** Terminal receipts from the adapter, keyed by the exact submitted command ID. */
export type PhoneCommandResults = Readonly<
  Record<string, { status: 'committed' | 'failed'; code?: string }>
>;
