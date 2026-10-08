/** Old name was an unclassified display label. Never infer whether it was a legal name. */
export function personKnownName(person: { knownName?: string | null }) {
  return person.knownName ?? '';
}
export function personSummary(person: {
  interaction?: string;
  experiences?: readonly { text: string }[];
}) {
  return person.interaction || person.experiences?.[0]?.text || '';
}
export function personDisplayName(knownName: string | null, temporaryLabel: string | null) {
  return knownName?.trim() || temporaryLabel?.trim() || '';
}
