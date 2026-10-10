/** Trusted editorial inputs still require reference, time and visibility validation. */
export type OfficialOpeningDraft = {
  /** Fixed fictional D0 in ISO format; runtime clock anchors realNow separately. */
  startAt: string;
  identity: string;
  /** Public situation only; never the director's hidden plot. */
  setting: string;
  actors: {
    key: string;
    name: string;
    relationship: string;
    /** This actor's own perspective and knowledge only. */
    persona: string;
  }[];
  actorTies: { fromKey: string; toKey: string; relationship: string; mayShare: boolean }[];
  facts: {
    key: string;
    text: string;
    visibility: { kind: 'owner' } | { kind: 'world' } | { kind: 'actors'; actorKeys: string[] };
  }[];
  /** NPC-authored editorial records, never fabricated player messages. */
  messages: {
    key: string;
    actorKey: string;
    text: string;
    minutesBeforeStart: number;
    history: boolean;
  }[];
  /** All opening invitations are proposed, never silently accepted. */
  invitations: {
    key: string;
    title: string;
    minutesAfterStart: number;
    actorKeys: string[];
    sourceMessageKey: string;
  }[];
  /** Player-known private notes/material excerpts; no hidden conditions or fake file links. */
  notes: { key: string; title: string; text: string }[];
};
