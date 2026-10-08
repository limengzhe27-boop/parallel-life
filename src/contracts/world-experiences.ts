import { z } from 'zod';
import { Id, Version, Timestamp } from './api.ts';
import type {
  Participant,
  ExperienceScope,
  ExperienceSource,
  ConversationChannel,
  GroupMembership,
  GroupConversation,
  MediaReference,
  GroupMessage,
  ScenePresence,
  SceneSession,
  ActionResolution,
  SceneAction,
  SceneEntry,
  MatterEvidence,
  CurrentMatter,
  ExperienceView,
  PlayerExperience,
  ExperienceAsset,
  ExperienceMediaRequest,
} from '../modules/world/domain/experience-rules.ts';
export type {
  Participant,
  ExperienceScope,
  ExperienceSource,
  ConversationChannel,
  GroupMembership,
  GroupConversation,
  MediaReference,
  GroupMessage,
  ScenePresence,
  SceneSession,
  ActionResolution,
  SceneAction,
  SceneEntry,
  MatterEvidence,
  CurrentMatter,
  ExperienceView,
  PlayerExperience,
  ExperienceAsset,
  ExperienceMediaRequest,
} from '../modules/world/domain/experience-rules.ts';

const Text = z.string().trim().min(1).max(4000);
const scope = { ownerId: Id, worldId: Id };
const source = { sourceEventId: Id, sourceVersion: Version };
const uniqueIds = z
  .array(Id)
  .max(100)
  .refine((v) => new Set(v).size === v.length, 'Duplicate IDs');
export const ExperienceScopeSchema = z.strictObject(scope) satisfies z.ZodType<ExperienceScope>;
export const ExperienceSourceSchema = z.strictObject(source) satisfies z.ZodType<ExperienceSource>;
export const ParticipantSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('player') }),
  z.strictObject({ kind: z.literal('actor'), actorId: Id }),
]) satisfies z.ZodType<Participant>;
export const ConversationChannelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('direct'), actorId: Id }),
  z.strictObject({ kind: z.literal('group'), conversationId: Id }),
]) satisfies z.ZodType<ConversationChannel>;
const IntervalSchema = z
  .strictObject({
    ...source,
    participant: ParticipantSchema,
    joinedVersion: Version,
    leftVersion: Version.optional(),
  })
  .refine(
    (m) =>
      m.sourceVersion === m.joinedVersion &&
      (m.leftVersion === undefined || m.leftVersion > m.joinedVersion),
    'Invalid interval',
  );
export const GroupMembershipSchema = IntervalSchema satisfies z.ZodType<GroupMembership>;
export const ScenePresenceSchema = IntervalSchema satisfies z.ZodType<ScenePresence>;
export const GroupConversationSchema = z.strictObject({
  ...scope,
  ...source,
  id: Id,
  title: z.string().trim().min(1).max(120),
  memberships: z.array(GroupMembershipSchema).min(1).max(1000),
}) satisfies z.ZodType<GroupConversation>;
export const MediaPurposeSchema = z.enum([
  'message_attachment',
  'scene_illustration',
  'scene_reference',
]);
export const MediaReferenceSchema = z
  .strictObject({
    ...scope,
    ...source,
    assetId: Id,
    purpose: MediaPurposeSchema,
    sharedByEventId: Id.optional(),
  })
  .refine(
    (m) => (m.purpose === 'message_attachment') === Boolean(m.sharedByEventId),
    'Only message attachments require sharing events',
  ) satisfies z.ZodType<MediaReference>;
export const GroupMessageSchema = z.strictObject({
  ...scope,
  ...source,
  id: Id,
  conversationId: Id,
  sender: ParticipantSchema,
  text: Text,
  media: z.array(MediaReferenceSchema).max(4),
}) satisfies z.ZodType<GroupMessage>;
export const SceneSessionSchema = z.strictObject({
  ...scope,
  ...source,
  id: Id,
  title: z.string().trim().min(1).max(120),
  appointmentId: Id.optional(),
  status: z.enum(['active', 'paused', 'ended']),
  presence: z.array(ScenePresenceSchema).max(1000),
}) satisfies z.ZodType<SceneSession>;
export const ActionIntentSchema = z.enum(['plan', 'hypothesis', 'attempt']);
export const ActionKindSchema = z.enum(['inspect', 'move', 'operate', 'speak', 'try']);
export const ActionResolutionSchema = z.strictObject({
  ...source,
  outcome: z.enum(['succeeded', 'failed', 'partial']),
  observation: Text,
}) satisfies z.ZodType<ActionResolution>;
export const SceneActionSchema = z
  .strictObject({
    ...scope,
    ...source,
    id: Id,
    commandId: Id,
    sceneId: Id,
    intent: ActionIntentSchema,
    kind: ActionKindSchema,
    text: Text,
    relatedMatterIds: uniqueIds,
    status: z.enum(['recorded', 'pending', 'unknown', 'resolved']),
    resolution: ActionResolutionSchema.optional(),
  })
  .refine(
    (a) =>
      a.intent === 'attempt'
        ? a.status !== 'recorded' && (a.status === 'resolved') === Boolean(a.resolution)
        : a.status === 'recorded' && a.resolution === undefined,
    'Plans/hypotheses and unresolved attempts have no result',
  ) satisfies z.ZodType<SceneAction>;
const entry = {
  ...scope,
  ...source,
  id: Id,
  sceneId: Id,
  observableTo: z
    .array(ParticipantSchema)
    .min(1)
    .max(100)
    .refine(
      (p) => new Set(p.map((v) => (v.kind === 'player' ? 'player' : v.actorId))).size === p.length,
      'Duplicate observers',
    ),
};
export const SceneEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...entry,
    kind: z.literal('narration'),
    text: Text,
    perspective: z.literal('observable'),
  }),
  z.strictObject({ ...entry, kind: z.literal('dialogue'), speaker: ParticipantSchema, text: Text }),
  z.strictObject({ ...entry, kind: z.literal('user_action'), actionId: Id, text: Text }),
  z.strictObject({
    ...entry,
    kind: z.literal('adjudicated_result'),
    actionId: Id,
    outcome: ActionResolutionSchema.shape.outcome,
    text: Text,
  }),
  z.strictObject({ ...entry, kind: z.literal('media_reference'), media: MediaReferenceSchema }),
  z.strictObject({
    ...entry,
    kind: z.literal('time_place'),
    storyAt: Timestamp,
    location: z.string().trim().min(1).max(200),
  }),
]) satisfies z.ZodType<SceneEntry>;
export const MatterStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'abandoned',
]);
export const MatterEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...source, kind: z.literal('progression'), reason: Text }),
  z.strictObject({
    ...source,
    kind: z.literal('user_report'),
    quote: Text,
    outcome: z.enum(['reported_done', 'blocked', 'abandoned']),
  }),
  z.strictObject({
    ...source,
    kind: z.literal('adjudicated_result'),
    actionId: Id,
    outcome: ActionResolutionSchema.shape.outcome,
  }),
]) satisfies z.ZodType<MatterEvidence>;
export const CurrentMatterSchema = z
  .strictObject({
    ...scope,
    ...source,
    id: Id,
    sceneId: Id,
    title: z.string().trim().min(1).max(200),
    status: MatterStatusSchema,
    evidence: MatterEvidenceSchema.optional(),
  })
  .refine((m) => m.status === 'not_started' || Boolean(m.evidence), 'Progress requires evidence')
  .refine((m) => {
    if (m.status === 'completed')
      return m.evidence?.kind === 'user_report'
        ? m.evidence.outcome === 'reported_done'
        : m.evidence?.kind === 'adjudicated_result' && m.evidence.outcome === 'succeeded';
    if (m.status === 'blocked')
      return m.evidence?.kind === 'user_report'
        ? m.evidence.outcome === 'blocked'
        : m.evidence?.kind === 'adjudicated_result' && m.evidence.outcome !== 'succeeded';
    if (m.status === 'abandoned')
      return m.evidence?.kind === 'user_report' && m.evidence.outcome === 'abandoned';
    return true;
  }, 'Evidence does not support the projected status') satisfies z.ZodType<CurrentMatter>;
export const ExperienceViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('phone') }),
  z.strictObject({ kind: z.literal('scene'), sceneId: Id }),
]) satisfies z.ZodType<ExperienceView>;
export const PlayerExperienceSchema = z
  .strictObject({
    ...scope,
    currentSceneId: Id.optional(),
    view: ExperienceViewSchema,
  })
  .refine(
    (e) => e.view.kind === 'phone' || e.view.sceneId === e.currentSceneId,
    'Scene view must reference the current scene',
  ) satisfies z.ZodType<PlayerExperience>;
const MediaStatusSchema = z.enum(['pending', 'unknown', 'failed', 'ready']);
export const ExperienceAssetSchema = z.strictObject({
  ...scope,
  ...source,
  id: Id,
  status: MediaStatusSchema,
}) satisfies z.ZodType<ExperienceAsset>;
export const ExperienceMediaRequestSchema = z
  .strictObject({
    ...scope,
    ...source,
    id: Id,
    purpose: MediaPurposeSchema,
    status: MediaStatusSchema,
    assetId: Id.optional(),
  })
  .refine(
    (m) => (m.status === 'ready') === Boolean(m.assetId),
    'Only ready media has an asset',
  ) satisfies z.ZodType<ExperienceMediaRequest>;

/** Commands never accept owner/world identity, sources, NPC outcomes, or observer lists. */
export const CreateGroupRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  title: z.string().trim().min(1).max(120),
  actorIds: uniqueIds.refine((ids) => ids.length >= 1 && ids.length <= 20),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;
export const GroupMessageRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  conversationId: Id,
  text: Text,
});
export type GroupMessageRequest = z.infer<typeof GroupMessageRequestSchema>;
export const SceneActionRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  sceneId: Id,
  intent: ActionIntentSchema,
  kind: ActionKindSchema,
  text: Text,
});
export type SceneActionRequest = z.infer<typeof SceneActionRequestSchema>;
/** Shared optional capability; absence in older projections means no saved experiences, not recreation. */
export const WorldExperiencesSchema = z.strictObject({
  groups: z.array(GroupConversationSchema).max(100).default([]),
  scenes: z.array(SceneSessionSchema).max(100).default([]),
  currentMatters: z.array(CurrentMatterSchema).max(100).default([]),
  player: PlayerExperienceSchema.optional(),
});
export type WorldExperiences = z.infer<typeof WorldExperiencesSchema>;
