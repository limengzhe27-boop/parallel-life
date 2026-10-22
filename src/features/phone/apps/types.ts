import type { z } from 'zod';
import type { AppointmentWaitPhoneActions } from '../../../contracts/appointment-wait.ts';
import type { GenesisSourceSchema } from '../../../contracts/world-records.ts';
import type { PlayerRecords } from '../../../contracts/world-records.ts';
import type { PhoneApp } from '../navigation.ts';
/** Display models only. The integration adapter owns authorization, storage and task polling. */
export type PhoneLink = { app: PhoneApp; target: string; label: string };
export type PhoneContact = {
  sourcePersonId?: string;
  id: string;
  name: string;
  relationship: string;
  summary?: string;
  publicProfile?: {
    identity?: string;
    traits?: string[];
    appearance?: string;
  };
  avatarUrl?: string;
  avatarKind?:
    'authorized-photo' | 'character-illustration' | 'generic-illustration' | 'publication-art';
  avatarLabel?: string;
  unread: number;
};
export type PhoneMessage = {
  id: string;
  actorId: string;
  role: 'user' | 'assistant';
  text: string;
  stickerId?: string;
  /** The server withheld the original text of this retracted message. */
  recalled?: boolean;
  at: string;
  status: 'pending' | 'sent' | 'failed' | 'unknown';
  /** A durable NPC prefix exists, but this reply did not finish. Not a failed user send. */
  replyInterrupted?: boolean;
  /** Initial server-verified history does not become a new notification. */
  initialRead?: boolean;
  /** Authored preset contents never count as runtime delivery. */
  origin?: 'fictional_history' | 'publication_preset';
  links?: PhoneLink[];
  photo?: PhonePhoto;
  mediaType?: 'image' | 'video';
  /** An authored historical chat attachment, read through this world's media authorization. */
  attachment?: {
    kind: 'image' | 'video';
    assetId: string;
    label?: string;
    url: string;
  };
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
  mediaType?: 'image' | 'video';
  mimeType?: string;
  links?: PhoneLink[];
};
export type PhoneInvitation = {
  origin?: z.infer<typeof GenesisSourceSchema>;
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
  origin?: {
    kind: 'publication_opening';
    workId: string;
    publicationVersion: number;
    draftVersion: number;
    contentHash: string;
  };
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
export type PhoneActions = AppointmentWaitPhoneActions & {
  enterScene?: (appointmentId: string) => Promise<PhoneActionReceipt>;
  setWallpaper?: (url: string) => void;
  uploadPhoto?: (file: File, commandId: string) => Promise<PhoneActionReceipt>;
  sendMessage?: (
    actorId: string,
    text: string,
    commandId: string,
    photo?: PhonePhoto,
    updateOp?: (patch: { canInterrupt?: boolean }) => void,
  ) => Promise<PhoneActionReceipt>;
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

/** Independently loaded read-only records. An unavailable read is never a successful empty list. */
export type PhoneRecordsState =
  | { status: 'loading' }
  | { status: 'ready'; data: PlayerRecords }
  | { status: 'error'; error: string };
