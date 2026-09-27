import type { WorldPhone } from '../../contracts/world-build.ts';
import type { NoteReceipt } from '../../contracts/notes.ts';

/** Preserve the canonical note ID/version even if the follow-up read fails. */
export function mergeNoteReceipt(
  current: WorldPhone | null,
  receipt: NoteReceipt,
): WorldPhone | null {
  if (!current || current.id !== receipt.worldId) return current;
  const existing = current.notes.find((note) => note.id === receipt.note.id);
  if (existing && existing.version > receipt.note.version) return current;
  return {
    ...current,
    version: Math.max(current.version ?? 0, receipt.version),
    notes: [receipt.note, ...current.notes.filter((note) => note.id !== receipt.note.id)],
  };
}
