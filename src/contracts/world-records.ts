import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
const SourceSchema = z.discriminatedUnion('kind', [
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
  kind: z.enum(['player_choice', 'actor_suggestion', 'invitation', 'opening_context']),
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
