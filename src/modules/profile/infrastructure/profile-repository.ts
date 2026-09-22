import { randomUUID } from 'node:crypto';
import { ProfileSchema, ProfileEditSchema, type ProfileEdit } from '../../../contracts/api.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
export class ProfileRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async get(ownerId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query('SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1', [
          ownerId,
        ])
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      return ProfileSchema.parse({ ...row.document, version: row.version });
    });
  }
  async edit(ownerId: string, raw: ProfileEdit) {
    const input = ProfileEditSchema.parse(raw);
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      if (row.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      const profile = ProfileSchema.parse({ ...row.document, version: row.version }),
        op = input.operation,
        now = new Date().toISOString();
      switch (op.kind) {
        case 'set-fact': {
          const existing = op.id ? profile.facts.find((f) => f.id === op.id) : null;
          if (op.id && !existing) throw new TaskError('NOT_FOUND');
          if (!existing && profile.facts.length >= 200) throw new TaskError('INVALID_INPUT');
          if (existing)
            Object.assign(existing, {
              category: op.category,
              value: op.value,
              status: 'confirmed',
              sourceMessageIds: [],
              updatedAt: now,
            });
          else
            profile.facts.push({
              id: randomUUID(),
              category: op.category,
              value: op.value,
              status: 'confirmed',
              sourceMessageIds: [],
              updatedAt: now,
            });
          break;
        }
        case 'confirm-fact':
        case 'delete-fact': {
          const fact = profile.facts.find((f) => f.id === op.id);
          if (!fact) throw new TaskError('NOT_FOUND');
          fact.status = op.kind === 'confirm-fact' ? 'confirmed' : 'rejected';
          fact.updatedAt = now;
          break;
        }
        case 'set-event': {
          const index = profile.events.findIndex((e) => e.id === op.event.id);
          const event = { ...op.event, sourceMessageIds: [] };
          if (index < 0) {
            if (profile.events.length >= 100) throw new TaskError('INVALID_INPUT');
            profile.events.push(event);
          } else profile.events[index] = event;
          break;
        }
        case 'delete-event': {
          if (!profile.events.some((e) => e.id === op.id)) throw new TaskError('NOT_FOUND');
          profile.events = profile.events.filter((e) => e.id !== op.id);
          break;
        }
        case 'set-person': {
          if (
            op.person.assetId &&
            !(
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND status='ready' FOR SHARE",
                [op.person.assetId],
              )
            ).rowCount
          )
            throw new TaskError('NOT_FOUND');
          const index = profile.people.findIndex((p) => p.id === op.person.id);
          if (index < 0) {
            if (profile.people.length >= 30) throw new TaskError('INVALID_INPUT');
            profile.people.push(op.person);
          } else profile.people[index] = op.person;
          break;
        }
        case 'delete-person': {
          if (!profile.people.some((p) => p.id === op.id)) throw new TaskError('NOT_FOUND');
          profile.people = profile.people.filter((p) => p.id !== op.id);
          break;
        }
        case 'set-portrait': {
          if (
            op.assetId &&
            !(
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND status='ready' FOR SHARE",
                [op.assetId],
              )
            ).rowCount
          )
            throw new TaskError('NOT_FOUND');
          profile.portraitAssetId = op.assetId;
          break;
        }
      }
      profile.version++;
      profile.updatedAt = now;
      const validated = ProfileSchema.parse(profile);
      await sql.query(
        'UPDATE parallel_life.profiles SET version=$2,document=$3,updated_at=now() WHERE owner_id=$1',
        [ownerId, profile.version, validated],
      );
      return validated;
    });
  }
}
