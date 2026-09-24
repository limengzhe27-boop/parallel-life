import { randomUUID } from 'node:crypto';
import { ProfileSchema, ProfileEditSchema, type ProfileEdit } from '../../../contracts/api.ts';
import type { MemoryCandidate } from '../../../contracts/memory.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';

/**
 * Apply a user-confirmed memory candidate while holding the profile row lock.
 * Candidate confirmation calls this inside its own transaction so the candidate
 * cannot become confirmed without the corresponding reality-profile update.
 */
function cleanForMatch(s: string) {
  return s.replace(/[，。！？、；：“”‘’\s,.!?;:'"]/g, '').toLowerCase();
}

export function isSimilarText(a: string, b: string): boolean {
  const ca = cleanForMatch(a);
  const cb = cleanForMatch(b);
  if (ca === cb) return true;
  if (!ca || !cb) return false;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const setA = new Set(ca);
  const setB = new Set(cb);
  let intersection = 0;
  for (const char of setA) {
    if (setB.has(char)) intersection++;
  }
  const minLen = Math.min(setA.size, setB.size);
  // 对于具有一定长度的经历陈述，字集交集超过50%即判定为语义同质描述
  return minLen >= 4 && intersection / minLen >= 0.5;
}

export async function applyConfirmedCandidateInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  candidate: Pick<MemoryCandidate, 'category' | 'text' | 'eventDate' | 'sourceMessageIds'>,
  now = new Date().toISOString(),
) {
  const row = (
    await sql.query(
      'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
      [ownerId],
    )
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  const profile = ProfileSchema.parse({ ...row.document, version: Number(row.version) });
  if (candidate.category === 'experience') {
    if (candidate.text.length > 120) throw new TaskError('INVALID_INPUT');
    const date = candidate.eventDate ?? null;
    const existing = profile.events.find(
      (event) =>
        (event.title === candidate.text || isSimilarText(event.title, candidate.text)) &&
        (event.date === date || !event.date || !date),
    );
    if (existing) {
      if (!existing.date && date) existing.date = date;
      existing.sourceMessageIds = [
        ...new Set([...existing.sourceMessageIds, ...candidate.sourceMessageIds]),
      ].slice(0, 20);
    } else {
      if (profile.events.length >= 100) throw new TaskError('INVALID_INPUT');
      profile.events.push({
        id: randomUUID(),
        title: candidate.text,
        date,
        feeling: null,
        sourceMessageIds: candidate.sourceMessageIds.slice(0, 20),
      });
    }
  } else {
    if (candidate.text.length > 500) throw new TaskError('INVALID_INPUT');
    const existing = profile.facts.find(
      (fact) =>
        fact.category === candidate.category &&
        (fact.value === candidate.text || isSimilarText(fact.value, candidate.text)) &&
        fact.status !== 'rejected',
    );
    if (existing) {
      existing.status = 'confirmed';
      existing.sourceMessageIds = [
        ...new Set([...existing.sourceMessageIds, ...candidate.sourceMessageIds]),
      ].slice(0, 20);
      existing.updatedAt = now;
    } else {
      if (profile.facts.length >= 200) throw new TaskError('INVALID_INPUT');
      profile.facts.push({
        id: randomUUID(),
        category: candidate.category,
        value: candidate.text,
        status: 'confirmed',
        sourceMessageIds: candidate.sourceMessageIds.slice(0, 20),
        updatedAt: now,
      });
    }
  }
  profile.version = Number(row.version) + 1;
  profile.updatedAt = now;
  const validated = ProfileSchema.parse(profile);
  await sql.query(
    'UPDATE parallel_life.profiles SET version=$2,document=$3,updated_at=now() WHERE owner_id=$1',
    [ownerId, profile.version, validated],
  );
  return validated;
}

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
          if (op.assetId && !profile.referenceAssetIds.includes(op.assetId)) {
            profile.referenceAssetIds.push(op.assetId);
          }
          break;
        }
        case 'add-reference-photo': {
          if (
            !(
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND status='ready' FOR SHARE",
                [op.assetId],
              )
            ).rowCount
          )
            throw new TaskError('NOT_FOUND');
          if (!profile.referenceAssetIds.includes(op.assetId)) {
            if (profile.referenceAssetIds.length >= 6) throw new TaskError('INVALID_INPUT');
            profile.referenceAssetIds.push(op.assetId);
          }
          if (!profile.portraitAssetId) {
            profile.portraitAssetId = op.assetId;
          }
          break;
        }
        case 'delete-reference-photo': {
          if (!profile.referenceAssetIds.includes(op.assetId)) throw new TaskError('NOT_FOUND');
          profile.referenceAssetIds = profile.referenceAssetIds.filter((id) => id !== op.assetId);
          if (profile.portraitAssetId === op.assetId) {
            profile.portraitAssetId = profile.referenceAssetIds[0] ?? null;
          }
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
