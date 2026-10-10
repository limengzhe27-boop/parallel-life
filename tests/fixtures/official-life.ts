import type { OfficialLifePack } from '../../src/modules/settings/application/official-life-pack.ts';
export function officialFixture(): OfficialLifePack {
  return {
    card: {
      id: 'county-yellow-hair',
      version: 1,
      title: 'Editorial fixture',
      hook: 'An invitation to answer',
      identityLabel: 'Adult fixture',
      experienceNote: 'Fictional authored opening',
    },
    story: {
      title: 'Editorial fixture',
      premise: 'Fictional town',
      opening: 'Answer the invitation',
      tradeoff: 'Choose your own time',
    },
    opening: {
      startAt: '2026-10-09T17:40:00+08:00',
      identity: 'Adult fictional mechanic',
      setting: 'The public garage',
      actors: Array.from({ length: 6 }, (_, i) => ({
        key: 'a' + i,
        name: 'Person ' + i,
        relationship: 'Known role ' + i,
        persona: 'Only my own knowledge ' + i,
      })),
      actorTies: [{ fromKey: 'a0', toKey: 'a1', relationship: 'Co-workers', mayShare: false }],
      facts: [
        {
          key: 'secret',
          text: 'Hidden car owner',
          visibility: { kind: 'actors', actorKeys: ['a0', 'a1'] },
        },
        { key: 'player_note', text: 'Player-only resource', visibility: { kind: 'owner' } },
        { key: 'public', text: 'Public opening fact', visibility: { kind: 'world' } },
      ],
      messages: [
        ...Array.from({ length: 6 }, (_, i) => ({
          key: 'old' + i,
          actorKey: 'a' + i,
          text: 'Fictional NPC record ' + i,
          minutesBeforeStart: 1440 + i * 61,
          history: true,
        })),
        ...[4, 12, 45].map((offset, i) => ({
          key: 'now' + i,
          actorKey: 'a' + i,
          text: 'Current invitation ' + i,
          minutesBeforeStart: offset,
          history: false,
        })),
      ],
      invitations: [
        {
          key: 'dinner',
          title: 'Dinner invitation',
          minutesAfterStart: 80,
          actorKeys: ['a0'],
          sourceMessageKey: 'old0',
        },
      ],
      notes: [
        {
          key: 'r17',
          title: 'Player-known repair summary',
          text: 'Editorial R17: repaired connection, not a signed contract.',
        },
      ],
    },
  };
}
