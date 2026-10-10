import { DomainError } from './errors.ts';
import type { WorldState } from './types.ts';

/** Optional experience projections. Existing WorldState and private-chat events stay unchanged. */
export type Participant = { kind: 'player' } | { kind: 'actor'; actorId: string };
export type ExperienceScope = { ownerId: string; worldId: string };
export type ExperienceSource = { sourceEventId: string; sourceVersion: number };
/** Runtime-owned event identity; loaded from storage, never copied from model/request claims. */
export type CommittedExperienceEvent = ExperienceScope & {
  id: string;
  version: number;
  /** Only the player's saved input, with runtime-validated intent; never an NPC paraphrase. */
  playerInput?: { text: string; intent: 'plan' | 'hypothesis' | 'attempt' | 'report' | 'speech' };
};
export type ExperienceContext = {
  world: Pick<WorldState, 'id' | 'ownerId' | 'version' | 'actors'> & {
    appointments?: WorldState['appointments'];
  };
  /** For atomic write validation, include the runtime-built event and resulting world version. */
  events: readonly CommittedExperienceEvent[];
};
export type ConversationChannel =
  { kind: 'direct'; actorId: string } | { kind: 'group'; conversationId: string };
/** Join is inclusive, leave exclusive; a rejoin creates another interval. */
export type MembershipInterval = {
  participant: Participant;
  joinedVersion: number;
  leftVersion?: number;
} & ExperienceSource;
export type GroupMembership = MembershipInterval;
export type GroupConversation = ExperienceScope &
  ExperienceSource & {
    id: string;
    title: string;
    memberships: GroupMembership[];
  };
export type MediaReference = ExperienceScope &
  ExperienceSource & {
    assetId: string;
    purpose: 'message_attachment' | 'scene_illustration' | 'scene_reference';
    /** A phone attachment requires a separate, committed act of sharing. */
    sharedByEventId?: string;
  };
export type GroupMessage = ExperienceScope &
  ExperienceSource & {
    id: string;
    conversationId: string;
    sender: Participant;
    text: string;
    media: MediaReference[];
  };
/** Appointment participants remain independent of both membership and physical presence. */
export type ScenePresence = MembershipInterval;
export type SceneSession = ExperienceScope &
  ExperienceSource & {
    id: string;
    title: string;
    appointmentId?: string;
    placeId?: string;
    status: 'active' | 'paused' | 'ended';
    presence: ScenePresence[];
  };
export type ActionResolution = ExperienceSource & {
  outcome: 'succeeded' | 'failed' | 'partial';
  observation: string;
};
export type SceneAction = ExperienceScope &
  ExperienceSource & {
    id: string;
    commandId: string;
    sceneId: string;
    intent: 'plan' | 'hypothesis' | 'attempt';
    kind: 'inspect' | 'move' | 'operate' | 'speak' | 'try';
    text: string;
    relatedMatterIds: string[];
    status: 'recorded' | 'pending' | 'unknown' | 'resolved';
    resolution?: ActionResolution;
  };
type EntryBase = ExperienceScope &
  ExperienceSource & {
    id: string;
    sceneId: string;
    /** Explicit observers/hearers at this event, never all group/appointment participants. */
    observableTo: Participant[];
  };
export type SceneEntry = EntryBase &
  (
    | { kind: 'narration'; text: string; perspective: 'observable' }
    | { kind: 'dialogue'; speaker: Participant; text: string }
    | { kind: 'user_action'; actionId: string; text: string }
    | {
        kind: 'adjudicated_result';
        actionId: string;
        outcome: ActionResolution['outcome'];
        text: string;
      }
    | { kind: 'media_reference'; media: MediaReference }
    | { kind: 'time_place'; storyAt: string; location: string }
  );
export type MatterStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'abandoned';
export type MatterEvidence = ExperienceSource &
  (
    | { kind: 'progression'; reason: string }
    | { kind: 'user_report'; quote: string; outcome: 'reported_done' | 'blocked' | 'abandoned' }
    | { kind: 'adjudicated_result'; actionId: string; outcome: ActionResolution['outcome'] }
  );
export type CurrentMatter = ExperienceScope &
  ExperienceSource & {
    id: string;
    sceneId: string;
    title: string;
    status: MatterStatus;
    /** user_report remains a report; it is never upgraded to an adjudicated world result. */
    evidence?: MatterEvidence;
  };
export type ExperienceView = { kind: 'phone' } | { kind: 'scene'; sceneId: string };
export type PlayerExperience = ExperienceScope & {
  currentSceneId?: string;
  view: ExperienceView;
};
export type ExperienceAsset = ExperienceScope &
  ExperienceSource & {
    id: string;
    status: 'pending' | 'unknown' | 'failed' | 'ready';
  };
export type ExperienceMediaRequest = ExperienceScope &
  ExperienceSource & {
    id: string;
    purpose: MediaReference['purpose'];
    status: 'pending' | 'unknown' | 'failed' | 'ready';
    assetId?: string;
  };

function invalid(message: string): never {
  throw new DomainError('INVALID_PROPOSAL', message);
}
function key(participant: Participant): string {
  return participant.kind === 'player' ? 'player' : `actor:${participant.actorId}`;
}
function hasParticipant(list: readonly Participant[], participant: Participant): boolean {
  return list.some((item) => key(item) === key(participant));
}
export function assertExperienceScope(context: ExperienceContext, scope: ExperienceScope): void {
  if (scope.worldId !== context.world.id || scope.ownerId !== context.world.ownerId)
    throw new DomainError('NOT_FOUND', 'Experience does not belong to this owner and world');
}
function assertParticipant(context: ExperienceContext, participant: Participant): void {
  if (
    participant.kind === 'actor' &&
    !context.world.actors.some((a) => a.id === participant.actorId)
  )
    invalid('Unknown actor in this world');
}
export function assertExperienceSource(
  context: ExperienceContext,
  scope: ExperienceScope & ExperienceSource,
): void {
  assertExperienceScope(context, scope);
  if (!Number.isSafeInteger(scope.sourceVersion) || scope.sourceVersion < 0)
    invalid('Invalid source version');
  const event = context.events.find((e) => e.id === scope.sourceEventId);
  if (!event || event.version !== scope.sourceVersion || event.version > context.world.version)
    invalid('Source must identify a committed event and its exact version');
  assertExperienceScope(context, event);
}
function presentAt(
  intervals: readonly MembershipInterval[],
  participant: Participant,
  version: number,
) {
  return intervals.some(
    (m) =>
      key(m.participant) === key(participant) &&
      version >= m.joinedVersion &&
      (m.leftVersion === undefined || version < m.leftVersion),
  );
}
function assertIntervals(
  context: ExperienceContext,
  scope: ExperienceScope & ExperienceSource,
  intervals: readonly MembershipInterval[],
): void {
  assertExperienceSource(context, scope);
  for (const interval of intervals) {
    assertParticipant(context, interval.participant);
    assertExperienceSource(context, { ...scope, ...interval });
    if (
      !Number.isSafeInteger(interval.joinedVersion) ||
      interval.joinedVersion < scope.sourceVersion ||
      interval.joinedVersion !== interval.sourceVersion ||
      (interval.leftVersion !== undefined &&
        (!Number.isSafeInteger(interval.leftVersion) ||
          interval.leftVersion <= interval.joinedVersion ||
          interval.leftVersion > context.world.version))
    )
      invalid('Invalid membership/presence interval');
    if (
      interval.leftVersion !== undefined &&
      !context.events.some(
        (e) =>
          e.version === interval.leftVersion &&
          e.worldId === scope.worldId &&
          e.ownerId === scope.ownerId,
      )
    )
      invalid('Leave must reference a committed world version');
  }
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i]!;
      const b = intervals[j]!;
      if (
        key(a.participant) === key(b.participant) &&
        a.joinedVersion < (b.leftVersion ?? Infinity) &&
        b.joinedVersion < (a.leftVersion ?? Infinity)
      )
        invalid('Overlapping membership/presence intervals');
    }
  }
}
export function assertGroupConversation(
  context: ExperienceContext,
  group: GroupConversation,
): void {
  assertIntervals(context, group, group.memberships);
}
export function assertGroupMessage(
  context: ExperienceContext,
  group: GroupConversation,
  message: GroupMessage,
  assets: readonly ExperienceAsset[] = [],
): void {
  assertGroupConversation(context, group);
  assertExperienceSource(context, message);
  assertParticipant(context, message.sender);
  if (
    message.conversationId !== group.id ||
    !presentAt(group.memberships, message.sender, message.sourceVersion)
  )
    invalid('Only a member at this event can send to this group');
  for (const media of message.media) {
    assertMediaReference(context, media, assets);
    if (media.purpose !== 'message_attachment' || media.sharedByEventId !== message.sourceEventId)
      invalid('Group media requires this message sharing event');
  }
}
/** Historical reading and NPC context use the very same join/leave boundaries. */
export function canReadGroupMessage(
  context: ExperienceContext,
  group: GroupConversation,
  message: GroupMessage,
  reader: Participant,
  assets: readonly ExperienceAsset[] = [],
): boolean {
  assertGroupMessage(context, group, message, assets);
  assertParticipant(context, reader);
  return presentAt(group.memberships, reader, message.sourceVersion);
}
/** An exited NPC receives no new context; old messages stay available only to historical reads. */
export function groupMessagesForActor(
  context: ExperienceContext,
  group: GroupConversation,
  messages: readonly GroupMessage[],
  actorId: string,
  assets: readonly ExperienceAsset[] = [],
): GroupMessage[] {
  assertGroupConversation(context, group);
  const reader: Participant = { kind: 'actor', actorId };
  assertParticipant(context, reader);
  if (!presentAt(group.memberships, reader, context.world.version)) return [];
  return messages.filter((m) => canReadGroupMessage(context, group, m, reader, assets));
}
export function assertSceneSession(context: ExperienceContext, scene: SceneSession): void {
  assertIntervals(context, scene, scene.presence);
  if (scene.appointmentId && !context.world.appointments?.some((a) => a.id === scene.appointmentId))
    invalid('Scene appointment must exist in this world');
}
function assertSceneWritable(
  context: ExperienceContext,
  scene: SceneSession,
  version: number,
): void {
  assertSceneSession(context, scene);
  if (scene.status !== 'active' || !presentAt(scene.presence, { kind: 'player' }, version))
    throw new DomainError('INVALID_COMMAND', 'Player must be present in an active scene');
}
function assertActionInput(context: ExperienceContext, action: SceneAction): void {
  const input = context.events.find((event) => event.id === action.sourceEventId)?.playerInput;
  if (!input || input.text !== action.text || input.intent !== action.intent)
    invalid('Action must preserve the actual player input and its validated intent');
}
function assertActionRecord(
  context: ExperienceContext,
  scene: SceneSession,
  action: SceneAction,
): void {
  assertExperienceSource(context, action);
  assertActionInput(context, action);
  if (
    action.sceneId !== scene.id ||
    !presentAt(scene.presence, { kind: 'player' }, action.sourceVersion)
  )
    invalid('Action belongs to another scene or player was not present');
  if (action.intent !== 'attempt') {
    if (action.status !== 'recorded' || action.resolution)
      invalid('Plans and hypotheses have no executed result');
  } else if (
    action.status === 'recorded' ||
    (action.status === 'resolved') !== Boolean(action.resolution)
  ) {
    invalid('Attempt status does not match its adjudication');
  }
  if (action.resolution)
    assertActionResolution(
      context,
      scene,
      { ...action, status: 'pending', resolution: undefined },
      action.resolution,
    );
}
/** Call before saving; an existing command is replayed by application receipt handling, never retried here. */
export function assertNewSceneAction(
  context: ExperienceContext,
  scene: SceneSession,
  action: SceneAction,
  existing: readonly SceneAction[],
): void {
  assertSceneWritable(context, scene, action.sourceVersion);
  assertActionRecord(context, scene, action);
  if (action.resolution || action.status === 'resolved')
    invalid('New input cannot arrive already adjudicated');
  if (existing.some((a) => a.id === action.id || a.commandId === action.commandId))
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Action or command already exists; use its saved receipt',
    );
}
export function assertActionResolution(
  context: ExperienceContext,
  scene: SceneSession,
  action: SceneAction,
  resolution: ActionResolution,
): void {
  assertExperienceSource(context, action);
  assertActionInput(context, action);
  assertSceneSession(context, scene);
  assertExperienceSource(context, { ...action, ...resolution });
  if (
    action.sceneId !== scene.id ||
    !presentAt(scene.presence, { kind: 'player' }, action.sourceVersion) ||
    action.intent !== 'attempt' ||
    action.status === 'resolved' ||
    !['pending', 'unknown'].includes(action.status)
  )
    invalid('Only an actual unresolved attempt can be adjudicated');
  if (
    !['succeeded', 'failed', 'partial'].includes(resolution.outcome) ||
    !resolution.observation.trim()
  )
    invalid('Unknown is a recovery status, never a successful result');
  if (resolution.sourceVersion <= action.sourceVersion)
    invalid('Adjudication must follow the saved input');
}
export function assertSceneEntry(
  context: ExperienceContext,
  scene: SceneSession,
  entry: SceneEntry,
  actions: readonly SceneAction[] = [],
  assets: readonly ExperienceAsset[] = [],
): void {
  assertSceneSession(context, scene);
  assertExperienceSource(context, entry);
  if (entry.sceneId !== scene.id || entry.sourceVersion < scene.sourceVersion)
    invalid('Entry belongs to another scene');
  if (
    !entry.observableTo.length ||
    new Set(entry.observableTo.map(key)).size !== entry.observableTo.length
  )
    invalid('Entry needs unique, explicit observers');
  for (const observer of entry.observableTo) {
    assertParticipant(context, observer);
    if (!presentAt(scene.presence, observer, entry.sourceVersion))
      invalid('Observer was not present at this event');
  }
  if (entry.kind === 'narration' && entry.perspective !== 'observable')
    invalid('Narration must use observable perspective');
  if (entry.kind === 'dialogue') {
    assertParticipant(context, entry.speaker);
    if (!presentAt(scene.presence, entry.speaker, entry.sourceVersion))
      invalid('Speaker was not present');
  }
  if (entry.kind === 'user_action' || entry.kind === 'adjudicated_result') {
    const action = actions.find((a) => a.id === entry.actionId);
    if (!action) invalid('Entry references an unknown action');
    assertActionRecord(context, scene, action);
    if (
      entry.kind === 'user_action' &&
      (action.sourceEventId !== entry.sourceEventId || entry.text !== action.text)
    )
      invalid('User action entry must preserve the saved input');
    if (
      entry.kind === 'adjudicated_result' &&
      (!action.resolution ||
        action.status !== 'resolved' ||
        action.resolution.sourceEventId !== entry.sourceEventId ||
        action.resolution.outcome !== entry.outcome ||
        action.resolution.observation !== entry.text)
    )
      invalid('Result entry must match a saved adjudication');
  }
  if (entry.kind === 'media_reference') {
    assertMediaReference(context, entry.media, assets);
    if (
      entry.media.purpose === 'message_attachment' ||
      entry.media.sourceVersion > entry.sourceVersion
    )
      invalid('Scene media is not a phone sharing event or a future result');
    if (
      entry.media.purpose === 'scene_illustration' &&
      entry.media.sourceEventId !== entry.sourceEventId
    )
      invalid('An illustration must depict this event; reuse must be marked scene_reference');
  }
}
export function visibleSceneEntries(
  context: ExperienceContext,
  scene: SceneSession,
  entries: readonly SceneEntry[],
  viewer: Participant = { kind: 'player' },
  actions: readonly SceneAction[] = [],
  assets: readonly ExperienceAsset[] = [],
): SceneEntry[] {
  assertParticipant(context, viewer);
  return entries.filter((entry) => {
    assertSceneEntry(context, scene, entry, actions, assets);
    return hasParticipant(entry.observableTo, viewer);
  });
}
const matterTransitions: Record<MatterStatus, readonly MatterStatus[]> = {
  not_started: ['in_progress', 'abandoned'],
  in_progress: ['blocked', 'completed', 'abandoned'],
  blocked: ['in_progress', 'completed', 'abandoned'],
  completed: [],
  abandoned: [],
};
export function transitionCurrentMatter(
  context: ExperienceContext,
  matter: CurrentMatter,
  status: MatterStatus,
  evidence: MatterEvidence,
  actions: readonly SceneAction[] = [],
): CurrentMatter {
  assertExperienceSource(context, matter);
  assertExperienceSource(context, { ...matter, ...evidence });
  if (
    !matterTransitions[matter.status].includes(status) ||
    evidence.sourceVersion <= (matter.evidence?.sourceVersion ?? matter.sourceVersion)
  )
    invalid('Illegal or stale matter transition');
  if (
    status === 'abandoned' &&
    (evidence.kind !== 'user_report' || evidence.outcome !== 'abandoned')
  )
    invalid('Abandonment requires the player’s explicit saved report');
  if (evidence.kind === 'adjudicated_result') {
    const action = actions.find((a) => a.id === evidence.actionId);
    if (
      !action ||
      action.sceneId !== matter.sceneId ||
      !action.relatedMatterIds.includes(matter.id) ||
      action.intent !== 'attempt' ||
      action.status !== 'resolved' ||
      !action.resolution
    )
      invalid('Matter needs a relevant saved attempt result');
    assertExperienceSource(context, action);
    assertActionInput(context, action);
    assertExperienceSource(context, { ...action, ...action.resolution });
    if (
      !['succeeded', 'failed', 'partial'].includes(action.resolution.outcome) ||
      !action.resolution.observation.trim() ||
      action.resolution.sourceVersion <= action.sourceVersion ||
      action.resolution.sourceEventId !== evidence.sourceEventId ||
      action.resolution.outcome !== evidence.outcome
    )
      invalid('Matter evidence must match the saved result');
    if (
      (status === 'completed' && evidence.outcome !== 'succeeded') ||
      (status === 'blocked' && evidence.outcome === 'succeeded')
    )
      invalid('Result does not support the target status');
  } else if (evidence.kind === 'user_report') {
    const input = context.events.find((event) => event.id === evidence.sourceEventId)?.playerInput;
    if (!input || input.intent !== 'report' || !input.text.includes(evidence.quote))
      invalid('User report must quote an actual saved player report, never a plan or NPC claim');
    const target = {
      reported_done: 'completed',
      blocked: 'blocked',
      abandoned: 'abandoned',
    } as const;
    if (!evidence.quote.trim() || target[evidence.outcome] !== status)
      invalid('Report does not support the target status');
  } else if (status === 'completed' || status === 'blocked' || !evidence.reason.trim()) {
    invalid('Progression alone cannot establish completion or a setback');
  }
  return { ...matter, status, evidence };
}
export function enterCurrentScene(
  context: ExperienceContext,
  experience: PlayerExperience,
  scene: SceneSession,
): PlayerExperience {
  assertExperienceScope(context, experience);
  assertSceneWritable(context, scene, context.world.version);
  if (experience.currentSceneId && experience.currentSceneId !== scene.id)
    throw new DomainError(
      'INVALID_COMMAND',
      'Explicitly leave the current scene before entering another',
    );
  return { ...experience, currentSceneId: scene.id, view: { kind: 'scene', sceneId: scene.id } };
}
/** Returning to the phone neither leaves the scene nor completes its matter. */
export function switchExperienceView(
  context: ExperienceContext,
  experience: PlayerExperience,
  view: ExperienceView,
): PlayerExperience {
  assertExperienceScope(context, experience);
  if (view.kind === 'scene' && view.sceneId !== experience.currentSceneId)
    throw new DomainError('INVALID_COMMAND', 'Can only reopen the current scene');
  return { ...experience, view };
}
/** Caller supplies the committed leave event; navigation alone cannot clear presence. */
export function leaveCurrentScene(
  context: ExperienceContext,
  experience: PlayerExperience,
  scene: SceneSession,
  source: ExperienceSource,
): { experience: PlayerExperience; scene: SceneSession } {
  assertExperienceScope(context, experience);
  assertSceneSession(context, scene);
  assertExperienceSource(context, { ...scene, ...source });
  if (experience.currentSceneId !== scene.id)
    throw new DomainError('INVALID_COMMAND', 'Not the current scene');
  const membership = scene.presence.find(
    (m) => m.participant.kind === 'player' && m.leftVersion === undefined,
  );
  if (!membership || source.sourceVersion <= membership.joinedVersion)
    invalid('Leave must follow arrival');
  const { currentSceneId: _current, ...rest } = experience;
  return {
    experience: { ...rest, view: { kind: 'phone' } },
    scene: {
      ...scene,
      presence: scene.presence.map((m) =>
        m === membership ? { ...m, leftVersion: source.sourceVersion } : m,
      ),
    },
  };
}
export function assertExperienceMedia(
  context: ExperienceContext,
  request: ExperienceMediaRequest,
  assets: readonly ExperienceAsset[],
): void {
  assertExperienceSource(context, request);
  if (request.status !== 'ready') {
    if (request.assetId)
      invalid('Pending, failed and unknown requests cannot advertise successful assets');
    return;
  }
  const asset = assets.find((a) => a.id === request.assetId);
  if (!asset || asset.status !== 'ready') invalid('Ready media needs a real successful asset');
  assertExperienceSource(context, asset);
  if (asset.sourceEventId !== request.sourceEventId)
    invalid('Media asset must derive from its source event');
}
export function assertMediaReference(
  context: ExperienceContext,
  media: MediaReference,
  assets: readonly ExperienceAsset[],
): void {
  assertExperienceSource(context, media);
  const asset = assets.find((a) => a.id === media.assetId);
  if (!asset || asset.status !== 'ready') invalid('Media reference needs a real ready asset');
  assertExperienceSource(context, asset);
  if (asset.sourceEventId !== media.sourceEventId)
    invalid('Media reference cannot relabel another event asset');
  if (media.purpose === 'message_attachment') {
    if (!media.sharedByEventId) invalid('Message attachment needs a committed sharing event');
    const event = context.events.find((e) => e.id === media.sharedByEventId);
    if (!event || event.version < media.sourceVersion) invalid('Invalid sharing event');
    assertExperienceScope(context, event);
  } else if (media.sharedByEventId) invalid('Scene illustration/reference is not a phone share');
}
