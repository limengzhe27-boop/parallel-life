/** A bounded server planning permission, never an authored goal or a world fact. */
export type ActorAgendaInitializeGrant = {
  worldId: string;
  actorId: string;
  engineEpoch: number;
  policy: 'npc_agenda_initialize_v1';
  definitionRef: string;
  admissionGenesisHash: string;
  candidateId: string;
  sourceIds: string[];
};
export function isAgendaInitializeInput(input: { text: string }): boolean {
  try {
    return JSON.parse(input.text)?.type === 'npc_agenda_initialize';
  } catch {
    return false;
  }
}
