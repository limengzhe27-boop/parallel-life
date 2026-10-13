import { Id } from '../../../contracts/api.ts';
import { publicationArt } from '../../../contracts/publication-assets.ts';
import { PublishedWorldContentSchema } from '../../../contracts/published-world-content.ts';
import { authoredSpace } from '../../world/domain/space.ts';
import { actorContext } from '../../world/application/actor-context.ts';
import type { WorldState } from '../../world/domain/types.ts';
import {
  publicationStorageIssues,
  type PublicationContent,
  type PublicationVisibility,
} from '../domain/publication-content.ts';
import type {
  PublicationCompileInput,
  PublicationCompileIssue,
  PublicationCompileResult,
  PublicationGenesisKeys,
  PublicationOpeningMetadata,
  PublicationRuntimeCompiler,
} from '../application/publication-runtime.ts';

export const PUBLICATION_GENESIS_MAX_BYTES = 65536;
const PERSONA_MAX_CHARS = 4000;
const sorted = <T extends { key: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.key.localeCompare(b.key, 'en'));
const issue = (code: string, path: (string | number)[] = []): PublicationCompileIssue => ({
  code,
  path,
});
const failure = (
  status: 'invalid' | 'unsupported',
  issues: PublicationCompileIssue[],
): PublicationCompileResult => ({ status, issues, capabilities: [] });
function dataRecord(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value),
    own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every(
      (key) =>
        typeof key === 'string' &&
        keys.includes(key) &&
        !!descriptors[key] &&
        'value' in descriptors[key]! &&
        descriptors[key]!.enumerable,
    )
  );
}
function validInput(input: PublicationCompileInput): boolean {
  if (
    !dataRecord(input, ['content', 'origin', 'originKind', 'worldId', 'ownerId', 'seedId', 'newId'])
  )
    return false;
  if (!dataRecord(input.origin, ['workId', 'publicationVersion', 'draftVersion', 'contentHash']))
    return false;
  return (
    [input.worldId, input.ownerId, input.seedId, input.origin.workId].every(
      (id) => Id.safeParse(id).success,
    ) &&
    new Set([input.worldId, input.ownerId, input.seedId]).size === 3 &&
    Number.isSafeInteger(input.origin.publicationVersion) &&
    ((input.originKind === 'published' && input.origin.publicationVersion >= 1) ||
      (input.originKind === 'trial' && input.origin.publicationVersion === 0)) &&
    Number.isSafeInteger(input.origin.draftVersion) &&
    input.origin.draftVersion >= 0 &&
    typeof input.origin.contentHash === 'string' &&
    /^[0-9a-f]{64}$/.test(input.origin.contentHash) &&
    typeof input.newId === 'function'
  );
}
function actorAllowed(v: PublicationVisibility, key: string): boolean {
  return v.kind === 'world' || (v.kind === 'actors' && v.actorKeys.includes(key));
}
function relatedToActor(r: PublicationContent['relationships'][number], key: string): boolean {
  return (
    (r.from.kind === 'actor' && r.from.actorKey === key) ||
    (r.to.kind === 'actor' && r.to.actorKey === key)
  );
}
function playerRelationship(
  c: PublicationContent,
  key: string,
  recipient: 'player' | 'actor',
): string {
  return sorted(c.relationships)
    .filter(
      (r) =>
        relatedToActor(r, key) &&
        (r.from.kind === 'player' || r.to.kind === 'player') &&
        (recipient === 'actor' ? actorAllowed(r.visibility, key) : r.visibility.kind !== 'actors'),
    )
    .map((r) => r.description)
    .join('\n');
}
function persona(c: PublicationContent, key: string): string {
  const actor = c.actors.find((a) => a.key === key)!;
  return JSON.stringify({
    ...actor.privatePersona,
    publicSetting: c.world.publicSetting,
    protagonistPublicIdentity: c.protagonist.identity,
    relationships: sorted(c.relationships)
      .filter((r) => actorAllowed(r.visibility, key))
      .map((r) => ({ key: r.key, from: r.from, to: r.to, description: r.description })),
  });
}
function unsupported(c: PublicationContent): PublicationCompileIssue[] {
  const out: PublicationCompileIssue[] = [];
  if (
    c.media.some(
      (m) =>
        !['avatar', 'cover'].includes(m.use) || !publicationArt(m, m.use as 'avatar' | 'cover'),
    ) ||
    c.phone.album.length ||
    c.places.some((p) => p.sceneMediaKey)
  )
    out.push(issue('unsupported_media', ['media']));
  c.candidates.forEach((node, i) => {
    if (node.intent.kind === 'offer_invitation' && node.intent.actorKeys.length !== 1)
      out.push(issue('unsupported_multi_actor_invitation', ['candidates', i, 'intent']));
  });
  c.extensions.forEach((e, i) => {
    if (e.purpose === 'runtime_required')
      out.push(issue('unsupported_runtime_extension', ['extensions', i]));
  });
  c.actors.forEach((a, i) => {
    if (!a.knownAtStart)
      out.push(issue('unsupported_unknown_actor_projection', ['actors', i, 'knownAtStart']));
    if (persona(c, a.key).length > PERSONA_MAX_CHARS)
      out.push(issue('persona_budget', ['actors', i, 'privatePersona']));
    if (
      playerRelationship(c, a.key, 'actor').length > 600 ||
      playerRelationship(c, a.key, 'player').length > 600
    )
      out.push(issue('relationship_budget', ['relationships']));
  });
  c.phone.notes.forEach((n, i) => {
    if (!n.factKeys.length) out.push(issue('notes_need_known_fact_basis', ['phone', 'notes', i]));
  });
  const knownPlaces = c.places.filter((p) => p.knownAtStart);
  if (knownPlaces.length > 16) out.push(issue('space_place_budget', ['places']));
  c.places.forEach((p, i) => {
    if (p.knownAtStart && p.name.length > 80)
      out.push(issue('space_name_budget', ['places', i, 'name']));
  });
  const knownKeys = new Set(knownPlaces.map((p) => p.key));
  c.routes.forEach((r, i) => {
    if (knownKeys.has(r.fromPlaceKey) && knownKeys.has(r.toPlaceKey) && r.minutes > 120)
      out.push(issue('space_route_budget', ['routes', i, 'minutes']));
  });
  return out;
}

/** Deterministic authored initialization only. Origin authenticity and persistence belong to the caller. */
export function compilePublicationGenesis(
  input: PublicationCompileInput,
): PublicationCompileResult {
  try {
    if (!validInput(input)) return failure('invalid', [issue('invalid_runtime_input')]);
  } catch {
    return failure('invalid', [issue('invalid_runtime_input')]);
  }
  const parsed = PublishedWorldContentSchema.safeParse(input.content);
  if (!parsed.success)
    return failure(
      'invalid',
      parsed.error.issues.map((e) =>
        issue(
          'invalid_content',
          e.path.filter(
            (p): p is string | number => typeof p === 'string' || typeof p === 'number',
          ),
        ),
      ),
    );
  const c = parsed.data,
    missing = unsupported(c);
  if (missing.length) return failure('unsupported', missing);
  const { worldId, ownerId, seedId, newId, originKind } = input;
  const allocated = new Set([worldId, ownerId, seedId, input.origin.workId]);
  function id(): string {
    const value = newId();
    if (!Id.safeParse(value).success || allocated.has(value)) throw Error('INVALID_GENERATED_ID');
    allocated.add(value);
    return value;
  }
  // Distinguishes authored publication times from legacy same-time notification reconstruction.
  const sourceEventId = `publication-genesis:${worldId}`;
  const origin = { ...input.origin };
  const keys: PublicationGenesisKeys = {
    actors: [],
    messages: [],
    history: [],
    invitations: [],
    notes: [],
    routes: [],
  };
  try {
    const actorIds = new Map(
      sorted(c.actors).map((a) => {
        const actorId = id();
        keys.actors.push({ key: a.key, id: actorId });
        return [a.key, actorId] as const;
      }),
    );
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId,
      version: 0,
      title: c.work.title,
      time: c.world.startAt,
      messageHistory: { version: 1, startAt: c.world.startAt, timeZone: 'UTC+08:00' },
      actors: sorted(c.actors).map((a) => ({
        id: actorIds.get(a.key)!,
        name: a.name,
        persona: persona(c, a.key),
        ...(playerRelationship(c, a.key, 'actor')
          ? { relationship: playerRelationship(c, a.key, 'actor') }
          : {}),
      })),
      actorTies: [],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    const playerKnown = new Set(c.protagonist.knownFactKeys);
    for (const f of sorted(c.history)) {
      const entry: PublicationGenesisKeys['history'][number] = {
        key: f.key,
        occurredAt: f.occurredAt,
      };
      if (playerKnown.has(f.key)) {
        entry.ownerFactId = id();
        world.facts.push({
          id: entry.ownerFactId,
          text: f.text,
          kind: 'canonical',
          visibility: { kind: 'owner' },
          sourceEventId,
        });
      }
      const recipients = sorted(c.actors)
        .filter(
          (a) =>
            actorAllowed(f.visibility, a.key) &&
            c.initialKnowledge.some((k) => k.actorKey === a.key && k.factKeys.includes(f.key)),
        )
        .map((a) => actorIds.get(a.key)!);
      if (recipients.length) {
        entry.actorFactId = id();
        world.facts.push({
          id: entry.actorFactId,
          text: f.text,
          kind: 'canonical',
          visibility: { kind: 'actors', actorIds: recipients },
          sourceEventId,
        });
      }
      // Mapping may retain an unconsumed source key; it never records that an NPC learned it.
      keys.history.push(entry);
    }
    const messageIds = new Map<string, string>();
    world.messages = [...c.phone.messages]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key, 'en'))
      .map((m) => {
        const messageId = id();
        messageIds.set(m.key, messageId);
        keys.messages.push({ key: m.key, id: messageId });
        return {
          id: messageId,
          actorId: actorIds.get(m.actorKey)!,
          role: m.speaker === 'player' ? 'user' : 'assistant',
          text: m.text,
          at: m.at,
          sourceEventId,
          initialRead: m.origin === 'history',
          ...(m.origin === 'history' ? { history: { version: 1 as const, key: m.key } } : {}),
        };
      });
    const invitationIds = new Map<string, string>();
    world.appointments = sorted(c.phone.invitations).map((inv) => {
      const invitationId = id();
      invitationIds.set(inv.key, invitationId);
      keys.invitations.push({ key: inv.key, id: invitationId });
      return {
        id: invitationId,
        title: inv.title,
        at: inv.at,
        participantIds: inv.actorKeys.map((key) => actorIds.get(key)!),
        sourceEventId,
        sourceMessageId: messageIds.get(inv.messageKey)!,
        status: 'proposed',
      };
    });
    const knownPlaces = sorted(c.places.filter((p) => p.knownAtStart)),
      knownKeys = new Set(knownPlaces.map((p) => p.key));
    const routes = [...c.routes]
      .filter((r) => knownKeys.has(r.fromPlaceKey) && knownKeys.has(r.toPlaceKey))
      .sort(
        (a, b) =>
          a.fromPlaceKey.localeCompare(b.fromPlaceKey, 'en') ||
          a.toPlaceKey.localeCompare(b.toPlaceKey, 'en'),
      );
    world.space = authoredSpace(
      {
        initialPlaceId: c.world.startPlaceKey,
        places: knownPlaces.map((p) => ({
          key: p.key,
          name: p.name,
          description: p.description,
          actorKeys: [],
          invitationKeys: c.phone.invitations.filter((a) => a.placeKey === p.key).map((a) => a.key),
        })),
        routes: routes.map((r, i) => {
          const routeId = `publication_route_${i}`;
          keys.routes.push({ fromPlaceKey: r.fromPlaceKey, toPlaceKey: r.toPlaceKey, id: routeId });
          return {
            key: routeId,
            from: r.fromPlaceKey,
            to: r.toPlaceKey,
            minutes: r.minutes,
            modeLabel: '移动',
          };
        }),
      },
      { kind: 'seed_genesis', seedId, snapshotVersion: 0 },
      actorIds,
      invitationIds,
    );
    const opening: PublicationOpeningMetadata = {
      kind: 'publication_opening',
      schemaVersion: 1,
      origin: { ...origin },
      originKind,
      identity: c.protagonist.identity,
      situation: c.protagonist.situation,
      setting: c.world.publicSetting,
      experienceNote: c.work.experienceNote,
      contacts: sorted(c.actors).map((a) => ({
        actorKey: a.key,
        actorId: actorIds.get(a.key)!,
        name: a.name,
        relationship: playerRelationship(c, a.key, 'player'),
        ...(a.publicCard.introduction ? { introduction: a.publicCard.introduction } : {}),
        ...(a.publicCard.identity ? { identity: a.publicCard.identity } : {}),
        traits: [...a.publicCard.traits],
        ...(a.publicCard.appearance ? { appearance: a.publicCard.appearance } : {}),
      })),
      notes: sorted(c.phone.notes).map((n) => {
        const noteId = id();
        keys.notes.push({ key: n.key, id: noteId });
        return {
          key: n.key,
          id: noteId,
          title: n.title,
          text: n.text,
          sourceEventId,
          factKeys: [...n.factKeys],
        };
      }),
    };
    if (
      new TextEncoder().encode(JSON.stringify({ world, opening, keys })).length >
      PUBLICATION_GENESIS_MAX_BYTES
    )
      return failure('unsupported', [issue('world_budget')]);
    if (publicationStorageIssues({ world, opening, keys }).length)
      return failure('unsupported', [issue('world_json_budget_or_shape')]);
    // The existing context builder must preserve every authorized opening fact, not silently drop it.
    for (const actor of world.actors) {
      const context = actorContext(world, actor.id);
      const expected = world.facts.filter(
        (f) => f.visibility.kind === 'actors' && f.visibility.actorIds.includes(actor.id),
      );
      if (expected.some((f) => !context.facts.some((visible) => visible.id === f.id)))
        return failure('unsupported', [
          issue('actor_history_budget', [
            'actors',
            keys.actors.findIndex((a) => a.id === actor.id),
          ]),
        ]);
    }
    return {
      status: 'compiled',
      world,
      opening,
      keys,
      origin,
      seedMetadata: {
        source: originKind === 'trial' ? 'publication_trial' : 'published_work',
        origin: { ...origin },
      },
      capabilities: [
        'publication.opening.v1',
        ...(c.media.length ? ['publication.media.v1'] : []),
        ...(c.timeline ? ['publication.timeline.v1'] : []),
        ...(c.candidates.some((n) => n.intent.kind === 'director_event')
          ? ['candidate.director_event.v1']
          : []),
        ...(c.candidates.some((n) => n.intent.kind === 'offer_message')
          ? ['candidate.offer_message.v1']
          : []),
        ...(c.candidates.some((n) => n.intent.kind === 'offer_invitation')
          ? ['candidate.offer_invitation.v1']
          : []),
      ],
    };
  } catch {
    return failure('invalid', [issue('invalid_genesis_allocation_or_state')]);
  }
}
export const publicationRuntimeCompiler: PublicationRuntimeCompiler = {
  compile: compilePublicationGenesis,
};
