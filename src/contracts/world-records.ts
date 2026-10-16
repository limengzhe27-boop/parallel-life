import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
export const HistoryLinkSchema = z.strictObject({
  app: z.enum(['messages', 'calendar', 'notes', 'photos']),
  target: z.string().min(1).max(200),
  label: z.string().min(1).max(40),
});
export const GenesisSourceSchema = z.strictObject({
  kind: z.literal('world_genesis'),
  worldId: Id,
  seedId: Id,
  messageId: Id,
  snapshotVersion: z.literal(0),
  at: Timestamp,
  timeBasis: z.literal('story'),
});
const SourceSchema = z.discriminatedUnion('kind', [
  GenesisSourceSchema,
  z.strictObject({
    kind: z.literal('opening_field'),
    seedId: Id,
    field: z.enum(['identity', 'setting', 'official_note', 'official_invitation']),
    key: z.string().max(80).optional(),
  }),
  z.strictObject({
    kind: z.literal('world_event'),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    messageId: z.string().optional(),
    at: Timestamp,
    timeBasis: z.enum(['story', 'recorded']),
  }),
  z.strictObject({
    kind: z.literal('world_matter'),
    matterId: z.string(),
    span: z.enum(['near_term', 'pursuit']),
    at: Timestamp,
    timeBasis: z.enum(['story', 'recorded']),
  }),
]);
/** Read-only, source-verified progress; never raw execution quotes or model flags. */
export const SceneStepChecklistSchema = z
  .strictObject({
    ruleVersion: z.literal('r17-delivery-v1'),
    requiredTotal: z.literal(4),
    completedRequired: z.number().int().min(0).max(4),
    steps: z
      .array(
        z.strictObject({
          id: z.enum([
            'order_reviewed',
            'repair_explained',
            'handed_over',
            'received',
            'connector_checked',
            'record_written',
            'receiver_inspected',
          ]),
          title: z.string().min(1).max(100),
          required: z.boolean(),
          performer: z.enum(['player', 'actor']),
          state: z.enum(['pending', 'completed']),
          actorName: z.string().trim().min(1).max(100).optional(),
          at: Timestamp.optional(),
        }),
      )
      .length(7),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.steps.map((step) => step.id));
    const required = new Set(['order_reviewed', 'repair_explained', 'handed_over', 'received']);
    let completed = 0;
    for (const [index, step] of value.steps.entries()) {
      if (
        step.required !== required.has(step.id) ||
        step.performer !==
          (['received', 'receiver_inspected'].includes(step.id) ? 'actor' : 'player')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index],
          message: 'Invalid step definition',
        });
      if (step.state === 'completed') {
        if (!step.at)
          ctx.addIssue({
            code: 'custom',
            path: ['steps', index, 'at'],
            message: 'Missing saved time',
          });
        if (step.required) completed++;
      } else if (step.at || step.actorName) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index],
          message: 'Pending step has no saved action',
        });
      }
      if (step.actorName && step.performer !== 'actor')
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'actorName'],
          message: 'Not an actor step',
        });
    }
    if (ids.size !== 7 || completed !== value.completedRequired)
      ctx.addIssue({ code: 'custom', message: 'Invalid progress summary' });
  });
export const PlayerRecordSchema = z.strictObject({
  id: z.string().startsWith('sys/'),
  kind: z.enum([
    'player_choice',
    'actor_suggestion',
    'invitation',
    'opening_context',
    'history_message',
    'world_matter',
  ]),
  span: z.enum(['near_term', 'pursuit']).optional(),
  title: z.string(),
  text: z.string(),
  state: z.enum([
    'planned',
    'suggested',
    'blocked',
    'reported_done',
    'abandoned',
    'superseded',
    'proposed',
    'confirmed',
    'cancelled',
    'attended',
    'missed',
    'starting_point',
    'in_progress',
    'completed',
    'not_started',
  ]),
  stateLabel: z.string(),
  assertion: z.enum([
    'player_statement',
    'actor_statement',
    'invitation_status',
    'starting_context',
    'world_verified',
  ]),
  source: SourceSchema,
  origin: GenesisSourceSchema.optional(),
  relatedLinks: z.array(HistoryLinkSchema).max(4).optional(),
  stepChecklist: SceneStepChecklistSchema.optional(),
  progress: z
    .strictObject({
      milestones: z
        .array(
          z.strictObject({
            title: z.string().min(1).max(100),
            at: Timestamp,
            recordId: z.string().startsWith('sys/'),
          }),
        )
        .max(10),
      opportunities: z
        .array(
          z.strictObject({
            title: z.string().min(1).max(100),
            recordId: z.string().startsWith('sys/'),
          }),
        )
        .max(10),
    })
    .optional(),
  opportunity: z
    .strictObject({
      pursuitRecordId: z.string().startsWith('sys/'),
      triggerRecordId: z.string().startsWith('sys/'),
    })
    .optional(),
  navigation: z
    .discriminatedUnion('app', [
      z.strictObject({ app: z.literal('wechat'), actorId: Id }),
      z.strictObject({ app: z.literal('calendar'), invitationId: z.string() }),
      z.strictObject({ app: z.literal('map'), placeId: z.string() }),
    ])
    .optional(),
});
export const PlayerRecordsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  worldId: Id,
  worldVersion: z.number().int().nonnegative(),
  coverage: z.literal('recent'),
  current: z.array(PlayerRecordSchema),
  about: z.array(PlayerRecordSchema),
  history: z.array(PlayerRecordSchema),
});
export type PlayerRecords = z.infer<typeof PlayerRecordsSchema>;
