import { createHash } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldRepository } from '../application/ports.ts';
import type {
  WorldState,
  Session,
  TurnCommand,
  WorldEvent,
  CommitResult,
} from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';
import { applyEvent } from '../domain/reducer.ts';
const fingerprint = (command: TurnCommand) =>
  createHash('sha256')
    .update(
      JSON.stringify([command.worldId, command.expectedVersion, command.actorId, command.text]),
    )
    .digest('hex');
function compact(state: WorldState) {
  return { ...state, messages: [], appointments: [], mediaRequests: [] };
}
/** Same domain contract as the test adapter; SQL transactions are the final commit boundary. */
export class PostgresWorldRepository implements WorldRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async initialize(session: Session, state: WorldState) {
    if (
      state.ownerId !== session.userId ||
      state.version !== 0 ||
      state.messages.length ||
      state.appointments.length ||
      state.mediaRequests.length
    )
      throw new DomainError('INVALID_COMMAND');
    await this.db.transaction(session.userId, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [state.id, session.userId, state.title, compact(state)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [state.id, session.userId, state, {}],
      );
    });
  }
  private async owned(sql: SqlClient, id: string, lock = false) {
    const row = (
      await sql.query(
        `SELECT state,version FROM parallel_life.worlds WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    return { ...row.state, version: row.version } as WorldState;
  }
  private async hydrate(sql: SqlClient, state: WorldState): Promise<WorldState> {
    const initial = (
      await sql.query('SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
        state.id,
      ])
    ).rows[0]?.state;
    const results = [];
    for (const table of ['world_messages', 'world_appointments', 'world_media_requests']) {
      // Only immutable projections belonging to events already committed at this receipt version.
      const rows = await sql.query(
        `SELECT p.document FROM parallel_life.${table} p JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id WHERE p.world_id=$1 AND e.version<=$2 ORDER BY e.version,${table === 'world_messages' ? 'p.ordinal' : 'p.id'}`,
        [state.id, state.version],
      );
      results.push(rows.rows.map((r) => r.document));
    }
    return {
      ...state,
      messages: [...(initial?.messages ?? []), ...results[0]!],
      appointments: [...(initial?.appointments ?? []), ...results[1]!],
      mediaRequests: [...(initial?.mediaRequests ?? []), ...results[2]!],
    };
  }
  async get(session: Session, id: string) {
    return this.db.transaction(session.userId, async (sql) =>
      this.hydrate(sql, await this.owned(sql, id)),
    );
  }
  private async saved(sql: SqlClient, command: TurnCommand): Promise<CommitResult | null> {
    const row = (
      await sql.query(
        'SELECT c.request_hash,c.result_state,e.payload FROM parallel_life.commands c LEFT JOIN parallel_life.world_events e ON e.id=c.result_event_id WHERE c.world_id=$1 AND c.id=$2',
        [command.worldId, command.id],
      )
    ).rows[0];
    if (!row) return null;
    if (row.request_hash !== fingerprint(command)) throw new DomainError('IDEMPOTENCY_CONFLICT');
    if (!row.payload) return null;
    return { state: await this.hydrate(sql, row.result_state), event: row.payload };
  }
  async receipt(session: Session, command: TurnCommand) {
    return this.db.transaction(session.userId, async (sql) => {
      await this.owned(sql, command.worldId);
      return this.saved(sql, command);
    });
  }
  async commit(session: Session, command: TurnCommand, event: WorldEvent) {
    return this.db.transaction(session.userId, async (sql) => {
      const current = await this.owned(sql, command.worldId, true),
        saved = await this.saved(sql, command);
      if (saved) return saved;
      if (current.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      if (
        event.commandId !== command.id ||
        event.worldId !== command.worldId ||
        event.data.actorId !== command.actorId ||
        event.data.userText !== command.text
      )
        throw new DomainError('INVALID_COMMAND');
      const hydrated = await this.hydrate(sql, current);
      const { state, jobs } = applyEvent(hydrated, event);
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [
          command.id,
          command.worldId,
          session.userId,
          command.expectedVersion,
          fingerprint(command),
          command,
        ],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, state.id, session.userId, event.version, command.id, event, event.occurredAt],
      );
      for (const message of state.messages.filter((x) => x.sourceEventId === event.id))
        await sql.query(
          'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
          [message.id, state.id, session.userId, message.actorId, message],
        );
      for (const appointment of state.appointments.filter((x) => x.sourceEventId === event.id))
        await sql.query(
          'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
          [appointment.id, state.id, session.userId, appointment],
        );
      for (const media of state.mediaRequests.filter((x) => x.sourceEventId === event.id))
        await sql.query(
          'INSERT INTO parallel_life.world_media_requests(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
          [media.id, state.id, session.userId, media],
        );
      for (const job of jobs)
        await sql.query(
          'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
          [job.id, state.id, session.userId, event.id, job],
        );
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
        [state.id, state.version, compact(state)],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
        [state.id, command.id, event.id, compact(state)],
      );
      return { state, event };
    });
  }
}
