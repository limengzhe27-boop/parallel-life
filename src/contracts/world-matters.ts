import { z } from 'zod';
import { Timestamp } from './api.ts';

export const EntityId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .min(1)
  .max(100);

export const MatterSpanSchema = z.enum(['near_term', 'pursuit']);
export type MatterSpan = z.infer<typeof MatterSpanSchema>;

export const MatterStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'abandoned',
  'superseded',
]);
export type MatterStatus = z.infer<typeof MatterStatusSchema>;

export const MatterAssertionSchema = z.enum([
  'player_statement',
  'world_verified',
  'actor_statement',
]);
export type MatterAssertion = z.infer<typeof MatterAssertionSchema>;

export const MatterSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('genesis'),
    seedId: EntityId,
    openingKey: z.string().max(80).optional(),
  }),
  z.strictObject({
    kind: z.literal('preset'),
    presetId: z.string().max(80),
    version: z.number().int().positive(),
    matterKey: z.string().max(80),
  }),
  z.strictObject({
    kind: z.literal('director_proposal'),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('actor_proposal'),
    actorId: EntityId,
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('scene_action'),
    sceneId: EntityId,
    actionId: EntityId,
    at: Timestamp,
  }),
]);
export type MatterSource = z.infer<typeof MatterSourceSchema>;

export const MatterEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('director_progression'),
    reason: z.string().min(1).max(300),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('user_report'),
    quote: z.string().min(1).max(200),
    outcome: z.enum(['reported_done', 'blocked', 'abandoned']),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('scene_action'),
    sceneId: EntityId,
    actionId: EntityId,
    outcome: z.enum(['succeeded', 'failed', 'partial']),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('scene_steps'),
    sceneId: EntityId,
    actionId: EntityId,
    ruleVersion: z.literal('r17-delivery-v1'),
    eventId: z.string().min(1),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('world_event'),
    reason: z.string().min(1).max(300),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    at: Timestamp,
  }),
]);
export type MatterEvidence = z.infer<typeof MatterEvidenceSchema>;

export const WorldMatterSchema = z
  .strictObject({
    id: EntityId,
    worldId: EntityId,
    span: MatterSpanSchema,
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    status: MatterStatusSchema,
    assertion: MatterAssertionSchema,
    visibility: z.enum(['player_visible', 'hidden']),
    prerequisites: z.array(EntityId).max(10).optional(),
    relatedActorIds: z.array(EntityId).max(10).optional(),
    relatedPlaceId: z.string().max(100).optional(),
    relatedInvitationId: z.string().max(100).optional(),
    source: MatterSourceSchema,
    evidence: MatterEvidenceSchema.optional(),
    version: z.number().int().positive(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    rewardClaimed: z.boolean().optional(),
    stepProgress: z
      .strictObject({
        ruleVersion: z.literal('r17-delivery-v1'),
        steps: z
          .array(
            z.strictObject({
              stepId: z.enum([
                'order_reviewed',
                'repair_explained',
                'handed_over',
                'received',
                'connector_checked',
                'record_written',
                'receiver_inspected',
              ]),
              performer: z.enum(['player', 'actor']),
              actorId: EntityId.optional(),
              receiverId: EntityId.optional(),
              sceneId: EntityId,
              actionId: EntityId,
              inputEventId: z.string().min(1),
              inputVersion: z.number().int().nonnegative(),
              eventId: z.string().min(1),
              eventVersion: z.number().int().positive(),
              at: Timestamp,
              inputQuote: z.string().min(1).max(4000),
              observationQuote: z.string().min(1).max(500),
              witnessActorIds: z.array(EntityId).max(8),
            }),
          )
          .max(7),
      })
      .optional(),
    pursuitProgress: z
      .strictObject({
        milestones: z
          .array(
            z.strictObject({
              matterId: EntityId,
              title: z.string().min(1).max(100),
              eventId: z.string().min(1),
              eventVersion: z.number().int().positive(),
              at: Timestamp,
            }),
          )
          .max(10),
        nextOpportunityIds: z.array(EntityId).max(10),
      })
      .optional(),
    opportunity: z
      .strictObject({
        pursuitId: EntityId,
        triggerMatterId: EntityId,
        key: z.string().min(1).max(80),
      })
      .optional(),
  })
  .refine(
    (m) =>
      (!m.pursuitProgress || m.span === 'pursuit') && (!m.opportunity || m.span === 'near_term'),
    'Progress belongs to pursuits and opportunities belong to near-term matters',
  )
  .refine(
    (m) =>
      !m.pursuitProgress ||
      (new Set(m.pursuitProgress.milestones.map((s) => s.matterId)).size ===
        m.pursuitProgress.milestones.length &&
        new Set(m.pursuitProgress.nextOpportunityIds).size ===
          m.pursuitProgress.nextOpportunityIds.length),
    'Progress sources and opportunities must be unique',
  )
  .refine((m) => {
    // If assertion is world_verified, evidence CANNOT be user_report
    if (m.assertion === 'world_verified') {
      return Boolean(m.evidence && m.evidence.kind !== 'user_report');
    }
    // If evidence is user_report, assertion CANNOT be world_verified
    if (m.evidence?.kind === 'user_report') {
      return m.assertion === 'player_statement';
    }
    return true;
  }, 'world_verified requires objective world/scene evidence, not player user_report')
  .refine((m) => {
    // If status is completed with user_report, assertion must be player_statement
    if (m.status === 'completed' && m.evidence?.kind === 'user_report') {
      return m.assertion === 'player_statement';
    }
    return true;
  }, 'Player reported completion cannot masquerade as world verification')
  .refine(
    (m) =>
      m.status !== 'completed' ||
      m.evidence?.kind !== 'scene_action' ||
      m.evidence.outcome === 'succeeded',
    'Failed or partial scene actions cannot complete a matter',
  );

export type WorldMatter = z.infer<typeof WorldMatterSchema>;

export const WorldMattersSchema = z.array(WorldMatterSchema).max(50);
