import type { PhoneInvitation } from './types.ts';

/**
 * Select the most relevant appointment for a contact chat thread:
 * 1. Prioritize active appointments ('confirmed' or 'proposed').
 * 2. If multiple active, prioritize the earliest upcoming or closest to story now.
 * 3. Fallback to most recent past appointment.
 */
export function findRelatedInvitation(
  invitations: readonly PhoneInvitation[],
  actorId: string,
  referenceTime?: string,
): PhoneInvitation | null {
  const matching = invitations.filter((inv) => inv.participantIds.includes(actorId));
  if (!matching.length) return null;

  const active = matching.filter(
    (inv) => inv.status === 'confirmed' || inv.status === 'proposed',
  );
  if (active.length > 0) {
    const refMs = referenceTime ? Date.parse(referenceTime) : Date.now();
    return (
      [...active].sort((a, b) => {
        const diffA = Date.parse(a.at) - refMs;
        const diffB = Date.parse(b.at) - refMs;
        if (diffA >= 0 && diffB >= 0) return diffA - diffB;
        if (diffA >= 0) return -1;
        if (diffB >= 0) return 1;
        return Math.abs(diffA) - Math.abs(diffB);
      })[0] ?? null
    );
  }

  return [...matching].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/**
 * Cross-app draft merging: preserves existing user draft, appending incoming text on a newline.
 * Avoids duplicate insertion if incoming text already exists in draft.
 */
export function mergeIncomingDraft(existingDraft: string | undefined, incomingText: string): string {
  const existing = existingDraft?.trim();
  const incoming = incomingText.trim();
  if (!existing) return incomingText;
  if (existing.includes(incoming)) return existingDraft!;
  return `${existingDraft}\n${incomingText}`;
}
