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
    field: z.enum(['identity', 'setting']),
  }),
  z.strictObject({
    kind: z.literal('world_event'),
    eventId: z.string(),
    eventVersion: z.number().int().positive(),
    messageId: z.string().optional(),
    at: Timestamp,
    timeBasis: z.enum(['story', 'recorded']),
  }),
]);
export const PlayerRecordSchema = z.strictObject({
  id: z.string().startsWith('sys/'),
  kind: z.enum([
    'player_choice',
    'actor_suggestion',
    'invitation',
    'opening_context',
    'history_message',
  ]),
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
  ]),
  stateLabel: z.string(),
  assertion: z.enum([
    'player_statement',
    'actor_statement',
    'invitation_status',
    'starting_context',
  ]),
  source: SourceSchema,
  origin: GenesisSourceSchema.optional(),
  relatedLinks: z.array(HistoryLinkSchema).max(4).optional(),
  navigation: z
    .discriminatedUnion('app', [
      z.strictObject({ app: z.literal('wechat'), actorId: Id }),
      z.strictObject({ app: z.literal('calendar'), invitationId: z.string() }),
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
