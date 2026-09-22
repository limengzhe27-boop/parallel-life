import { DomainError } from '../domain/errors.ts';
import { applyEvent } from '../domain/reducer.ts';
import type { WorldRepository } from '../application/ports.ts';
import type {
  CommitResult,
  OutboxJob,
  Session,
  TurnCommand,
  WorldEvent,
  WorldState,
} from '../domain/types.ts';

const fingerprint = (command: TurnCommand) =>
  JSON.stringify([command.worldId, command.expectedVersion, command.actorId, command.text]);

/** Test adapter only. Never wire to production HTTP handlers or claim durable storage. */
export class MemoryWorldRepository implements WorldRepository {
  private states = new Map<string, WorldState>();
  private receipts = new Map<string, { fingerprint: string; result: CommitResult }>();
  private events: WorldEvent[] = [];
  private jobs: OutboxJob[] = [];
  constructor(seed: WorldState[]) {
    for (const world of seed) this.states.set(world.id, structuredClone(world));
  }
  private owned(session: Session, worldId: string): WorldState {
    const world = this.states.get(worldId);
    if (!world || world.ownerId !== session.userId) throw new DomainError('NOT_FOUND');
    return world;
  }
  async get(session: Session, worldId: string): Promise<WorldState> {
    return structuredClone(this.owned(session, worldId));
  }
  private existing(session: Session, command: TurnCommand): CommitResult | null {
    this.owned(session, command.worldId);
    const saved = this.receipts.get(`${command.worldId}:${command.id}`);
    if (!saved) return null;
    if (saved.fingerprint !== fingerprint(command)) throw new DomainError('IDEMPOTENCY_CONFLICT');
    return structuredClone(saved.result);
  }
  async receipt(session: Session, command: TurnCommand): Promise<CommitResult | null> {
    return this.existing(session, command);
  }
  async commit(session: Session, command: TurnCommand, event: WorldEvent): Promise<CommitResult> {
    const saved = this.existing(session, command);
    if (saved) return saved;
    const current = this.owned(session, command.worldId);
    if (current.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
    if (
      event.commandId !== command.id ||
      event.worldId !== command.worldId ||
      event.data.actorId !== command.actorId ||
      event.data.userText !== command.text
    )
      throw new DomainError('INVALID_COMMAND');
    if (this.events.some((item) => item.id === event.id)) throw new DomainError('INVALID_PROPOSAL');
    const { state, jobs } = applyEvent(current, event);
    const result = structuredClone({ state, event });
    // No await in this commit section: atomic within this process only.
    this.states.set(current.id, state);
    this.events.push(structuredClone(event));
    this.jobs.push(...structuredClone(jobs));
    this.receipts.set(`${command.worldId}:${command.id}`, {
      fingerprint: fingerprint(command),
      result,
    });
    return structuredClone(result);
  }
  inspectForTest() {
    return structuredClone({ events: this.events, jobs: this.jobs });
  }
}
