import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';
import type { Note, WorldState } from './types.ts';

export type NoteCommand = {
  commandId: string;
  worldId: string;
  /** Absent means the server assigns the id (a brand-new note). */
  id?: string;
  title: string;
  text: string;
  /** The note's own version: 0 when it is not persisted yet. */
  expectedVersion: number;
};
export type NoteEvent = {
  schemaVersion: 1;
  type: 'note.saved';
  id: string;
  worldId: string;
  version: number;
  commandId: string;
  occurredAt: string;
  storyTime: string;
  data: NoteCommand;
};
const NOTE_ID = /^[a-zA-Z0-9_:-]{1,140}$/;

/** A user's own private note. Creating one never claims anything about the world. */
export function applyNoteEvent(current: WorldState, event: NoteEvent): WorldState {
  const command = event.data;
  try {
    for (const id of [event.id, event.commandId, event.worldId]) validateEventId(id);
    isoInstant(event.occurredAt);
    isoInstant(event.storyTime);
    if (!NOTE_ID.test(command.id ?? '')) throw new Error('Invalid note id');
    if (!command.title.trim() || command.title.length > 80) throw new Error('Invalid title');
    if (command.text.length > 2000) throw new Error('Invalid text');
    if (
      event.schemaVersion !== 1 ||
      event.type !== 'note.saved' ||
      event.commandId !== command.commandId ||
      event.worldId !== command.worldId ||
      !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0
    )
      throw new Error('Invalid note save');
  } catch {
    throw new DomainError('INVALID_COMMAND');
  }
  /* expectedVersion is the NOTE's version (guarded below); the world version is
     checked by the repository under lock and must advance by exactly one. */
  if (current.id !== command.worldId || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  const next = structuredClone(current);
  const notes = next.notes ?? [];
  const existing = notes.find((note) => note.id === command.id);
  if (existing) {
    /* Optimistic concurrency on the note itself: two devices must not overwrite each other. */
    if (existing.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
    existing.title = command.title.trim();
    existing.text = command.text;
    existing.version += 1;
    existing.updatedAt = event.occurredAt;
    existing.sourceEventId = event.id;
  } else {
    if (notes.length >= 200) throw new DomainError('INVALID_COMMAND');
    const note: Note = {
      id: command.id!,
      title: command.title.trim(),
      text: command.text,
      version: 1,
      updatedAt: event.occurredAt,
      sourceEventId: event.id,
    };
    next.notes = [...notes, note];
  }
  next.version = event.version;
  return next;
}
