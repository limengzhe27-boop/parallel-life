import { z } from 'zod';
import { Id, Timestamp } from './api.ts';

/**
 * Wire contracts for the world clock and the director brief.
 *
 * Deliberately separate from the phone contracts: the phone UI and any future client
 * read the same shapes, and adding a field here can never break the app projections.
 */
const ClockValuesSchema = z.strictObject({
  storyNow: Timestamp,
  speed: z.number().min(0).max(60),
  paused: z.boolean(),
  lastTickAt: Timestamp,
  missedBeats: z.number().int().nonnegative(),
  summary: z.string().nullable(),
});
/** Reads contain clock values; successful controls also carry a committed receipt. */
export const WorldClockSchema = z.union([
  ClockValuesSchema,
  ClockValuesSchema.extend({ status: z.literal('committed') }).transform(
    ({ status: _status, ...clock }) => clock,
  ),
]);
export type WorldClock = z.infer<typeof WorldClockSchema>;

export const WorldClockControlSchema = z
  .strictObject({
    paused: z.boolean().optional(),
    speed: z.number().min(0).max(60).optional(),
  })
  .refine((input) => input.paused !== undefined || input.speed !== undefined, {
    message: 'paused or speed is required',
  });

export const AdvanceReceiptSchema = z.strictObject({
  status: z.literal('advanced'),
  worldId: Id,
  storyNow: Timestamp,
  played: z.number().int().nonnegative(),
  folded: z.number().int().nonnegative(),
  summary: z.string().nullable(),
  actors: z.array(Id),
});
export type AdvanceReceipt = z.infer<typeof AdvanceReceiptSchema>;

export const WorldDirectionSchema = z.strictObject({
  guidance: z.string().max(500).default(''),
  themes: z.array(z.string().max(40)).max(5).default([]),
  pacing: z.enum(['slow', 'normal', 'fast']).default('normal'),
  focusActorIds: z.array(Id).max(3).default([]),
});
export type WorldDirection = z.infer<typeof WorldDirectionSchema>;

export const WorldDirectionRequestSchema = WorldDirectionSchema.partial().extend({
  preview: z.boolean().optional(),
  move: z.enum(['future', 'past']).optional(),
});

export const WorldDirectionReceiptSchema = z.strictObject({
  direction: WorldDirectionSchema,
  impact: z.strictObject({
    beatsPerAdvance: z.number().int().nonnegative(),
    speaksFirst: z.string().nullable(),
    themes: z.array(z.string()),
  }),
  applied: z.boolean(),
});
export type WorldDirectionReceipt = z.infer<typeof WorldDirectionReceiptSchema>;
