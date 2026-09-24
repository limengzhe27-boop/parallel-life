/**
 * One durable side effect emitted by a committed world event. It is written inside
 * the same transaction as the event, so a crash can never lose it — but it used to
 * have no consumer, so nothing ever executed it.
 */
export type OutboxPayload = {
  id: string;
  eventId: string;
  worldId: string;
  type: string;
  requestId?: string;
  prompt?: string;
};
export type OutboxJob = {
  id: string;
  ownerId: string;
  worldId: string;
  eventId: string;
  status: string;
  attempts: number;
  payload: OutboxPayload;
};

/** Only these job types have an executor. An unknown one fails loudly, never silently. */
export const OUTBOX_EXECUTORS: Record<
  string,
  { kind: 'media'; scopeOf: (payload: OutboxPayload) => string }
> = {
  'image.generate': {
    kind: 'media',
    scopeOf: (payload) => {
      if (!payload.requestId) throw new Error('OUTBOX_MISSING_REQUEST_ID');
      return payload.requestId;
    },
  },
};
