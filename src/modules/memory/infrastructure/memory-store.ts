import { MemoryRecordSchema } from '../../../contracts/memory.ts';
import { deriveMemory, type DeriveMemoryInput } from '../application/derive-memory.ts';
import { correctMemory, forgetMemory } from '../application/edit-memory.ts';
import type { MemoryRecord, MemoryScope } from '../domain/types.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';

/**
 * One place that writes memories, shared by every agent that produces them.
 *
 * Memories used to be written by a single insert with no duplicate check, which is
 * why the same thing could be sedimented again and again. A repeat of an active
 * memory in the same scope and kind now MERGES its source evidence into the record
 * that already exists, so nothing is lost and nothing is duplicated.
 */
export type StorageSummary = { created: number; merged: number };

/** The provenance table is per message kind, so the ref type follows the scope. */
const REF_TYPE: Record<MemoryScope, string> = {
  profile: 'interview_message',
  branch: 'world_event',
  character: 'world_message',
};

/** Same wording, different whitespace or case, is the same memory. */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function deriveAndStoreMemories(
  sql: SqlClient,
  items: DeriveMemoryInput[],
): Promise<StorageSummary> {
  const summary: StorageSummary = { created: 0, merged: 0 };
  for (const item of items) {
    const derived = deriveMemory(item);
    const normalized = normalizeMemoryText(derived.text);
    const existing = (
      await sql.query(
        `SELECT id, source_ids FROM parallel_life.memory_records
          WHERE owner_id=$1 AND scope_type=$2 AND scope_id=$3 AND kind=$4 AND status='active'
            AND (($5::text IS NOT NULL AND key = $5)
                 OR lower(regexp_replace(text, '\\s+', ' ', 'g')) = $6)
          ORDER BY created_at ASC LIMIT 1`,
        [
          derived.ownerId,
          derived.scopeType,
          derived.scopeId,
          derived.kind,
          derived.key ?? null,
          normalized,
        ],
      )
    ).rows[0];
    if (existing) {
      await addSourceRefs(sql, String(existing.id), derived.ownerId, derived.scopeType, derived.sourceIds);
      summary.merged += 1;
      continue;
    }
    await sql.query(
      `INSERT INTO parallel_life.memory_records
        (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        derived.id,
        derived.ownerId,
        derived.scopeType,
        derived.scopeId,
        derived.branchId ?? null,
        derived.characterId ?? null,
        derived.kind,
        derived.text,
        derived.key ?? null,
        derived.sourceType,
        JSON.stringify(derived.sourceIds),
        derived.status,
        derived.importance,
        derived.createdAt,
      ],
    );
    await addSourceRefs(sql, derived.id, derived.ownerId, derived.scopeType, derived.sourceIds);
    summary.created += 1;
  }
  return summary;
}

async function addSourceRefs(
  sql: SqlClient,
  memoryId: string,
  ownerId: string,
  scope: MemoryScope,
  sourceIds: string[],
) {
  for (const sourceId of sourceIds)
    await sql.query(
      `INSERT INTO parallel_life.memory_source_refs(memory_id,owner_id,source_type,source_id)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [memoryId, ownerId, REF_TYPE[scope], sourceId],
    );
}

/** Reads one owner's records in the shape the memory services expect. */
export async function loadMemoryRecords(
  sql: SqlClient,
  ownerId: string,
): Promise<MemoryRecord[]> {
  const rows = (
    await sql.query('SELECT * FROM parallel_life.memory_records WHERE owner_id=$1 FOR UPDATE', [
      ownerId,
    ])
  ).rows;
  return rows.map((row) =>
    MemoryRecordSchema.parse({
      id: row.id,
      ownerId: row.owner_id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      branchId: row.branch_id ?? undefined,
      characterId: row.character_id ?? undefined,
      kind: row.kind,
      text: row.text,
      key: row.key ?? undefined,
      sourceType: row.source_type,
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
      status: row.status,
      importance: Number(row.importance),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }),
  );
}

/**
 * The user saying "that is wrong": the old record is superseded and a correction is
 * stored with the user's own wording and sources.
 */
export async function correctMemoryInStore(
  sql: SqlClient,
  input: {
    ownerId: string;
    key: string;
    newText: string;
    scopeType: MemoryScope;
    scopeId: string;
    branchId?: string;
    characterId?: string;
    sourceMessageIds: string[];
  },
): Promise<MemoryRecord> {
  const { newRecord, supersededRecords } = correctMemory({
    ...input,
    existingRecords: await loadMemoryRecords(sql, input.ownerId),
  });
  for (const superseded of supersededRecords)
    await sql.query(
      "UPDATE parallel_life.memory_records SET status='superseded' WHERE owner_id=$1 AND id=$2",
      [input.ownerId, superseded.id],
    );
  await sql.query(
    `INSERT INTO parallel_life.memory_records
      (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      newRecord.id,
      newRecord.ownerId,
      newRecord.scopeType,
      newRecord.scopeId,
      newRecord.branchId ?? null,
      newRecord.characterId ?? null,
      newRecord.kind,
      newRecord.text,
      newRecord.key ?? null,
      newRecord.sourceType,
      JSON.stringify(newRecord.sourceIds),
      newRecord.status,
      newRecord.importance,
      newRecord.createdAt,
    ],
  );
  await addSourceRefs(sql, newRecord.id, newRecord.ownerId, newRecord.scopeType, newRecord.sourceIds);
  return newRecord;
}

/** The user saying "forget it": the record is forgotten, never deleted. */
export async function forgetMemoryInStore(
  sql: SqlClient,
  input: { ownerId: string; targetMemoryId: string; evidence?: Record<string, unknown> },
): Promise<MemoryRecord> {
  const records = await loadMemoryRecords(sql, input.ownerId);
  const target = records.find((record) => record.id === input.targetMemoryId);
  if (!target) throw new Error('NOT_FOUND');
  const { forgottenRecord, cascadedRecordIds } = forgetMemory({
    ownerId: input.ownerId,
    targetMemoryId: input.targetMemoryId,
    existingRecords: records,
    evidence: (input.evidence as never) ?? {
      [target.id]: { id: target.id, text: target.text },
    },
  });
  for (const id of [forgottenRecord.id, ...cascadedRecordIds])
    await sql.query(
      "UPDATE parallel_life.memory_records SET status='forgotten' WHERE owner_id=$1 AND id=$2",
      [input.ownerId, id],
    );
  return forgottenRecord;
}

/** Active memories of one scope, newest first — what the phone and the director read. */
export async function listMemories(
  sql: SqlClient,
  ownerId: string,
  filter: { scopeType?: MemoryScope; scopeId?: string; characterId?: string; includeInactive?: boolean } = {},
) {
  const rows = (
    await sql.query(
      `SELECT * FROM parallel_life.memory_records
        WHERE owner_id=$1
          AND ($2::text IS NULL OR scope_type=$2)
          AND ($3::text IS NULL OR scope_id=$3)
          AND ($4::text IS NULL OR character_id=$4)
          AND ($5::boolean OR status='active')
        ORDER BY created_at DESC LIMIT 200`,
      [
        ownerId,
        filter.scopeType ?? null,
        filter.scopeId ?? null,
        filter.characterId ?? null,
        Boolean(filter.includeInactive),
      ],
    )
  ).rows;
  return rows.map((row) => ({
    id: String(row.id),
    scopeType: String(row.scope_type),
    scopeId: String(row.scope_id),
    characterId: row.character_id ? String(row.character_id) : null,
    kind: String(row.kind),
    text: String(row.text),
    status: String(row.status),
    importance: Number(row.importance),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}
