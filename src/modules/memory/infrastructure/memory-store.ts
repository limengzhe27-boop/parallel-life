import { MemoryRecordSchema } from '../../../contracts/memory.ts';
import { deriveMemory, type DeriveMemoryInput } from '../application/derive-memory.ts';
import { correctMemory, forgetMemory } from '../application/edit-memory.ts';
import { DomainError } from '../domain/errors.ts';
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
    MemoryRecordSchema.parse(derived);
    // Short transaction scope serializes empty-set checks too; no new lock table.
    await lockMemoryScope(sql, derived.ownerId, derived.scopeType, derived.scopeId);
    const normalized = normalizeMemoryText(derived.text);
    const protection = (
      await sql.query(
        `SELECT status, source_type FROM parallel_life.memory_records
       WHERE owner_id=$1 AND scope_type=$2 AND scope_id=$3
       AND branch_id IS NOT DISTINCT FROM $4 AND character_id IS NOT DISTINCT FROM $5
       AND ((status='forgotten' AND source_ids ?| $6::text[])
         OR ($7::text IS NOT NULL AND key=$7 AND source_type='user_correction')
         OR (status='superseded' AND key IS NOT DISTINCT FROM $7 AND source_ids @> to_jsonb($6::text[])))`,
        [
          derived.ownerId,
          derived.scopeType,
          derived.scopeId,
          derived.branchId ?? null,
          derived.characterId ?? null,
          derived.sourceIds,
          derived.key ?? null,
        ],
      )
    ).rows;
    if (protection.some((r) => r.status === 'forgotten')) derived.status = 'forgotten';
    else if (
      protection.some((r) => r.status === 'superseded') ||
      (derived.sourceType !== 'user_correction' && protection.length)
    )
      derived.status = 'superseded';
    const existing = (
      await sql.query(
        `SELECT id, source_ids FROM parallel_life.memory_records
          WHERE owner_id=$1 AND scope_type=$2 AND scope_id=$3 AND kind=$4 AND status=$11
            AND key IS NOT DISTINCT FROM $5
            AND lower(btrim(regexp_replace(text, '\\s+', ' ', 'g'))) = $6
            AND branch_id IS NOT DISTINCT FROM $7 AND character_id IS NOT DISTINCT FROM $8
            AND source_type=$9
            AND (SELECT count(DISTINCT s) FROM jsonb_array_elements_text(source_ids || $10::jsonb) AS refs(s)) <= 32
          ORDER BY created_at ASC LIMIT 1`,
        [
          derived.ownerId,
          derived.scopeType,
          derived.scopeId,
          derived.kind,
          derived.key ?? null,
          normalized,
          derived.branchId ?? null,
          derived.characterId ?? null,
          derived.sourceType,
          JSON.stringify(derived.sourceIds),
          derived.status,
        ],
      )
    ).rows[0];
    if (existing) {
      const sources = [...new Set([...(existing.source_ids as string[]), ...derived.sourceIds])];
      await sql.query(
        'UPDATE parallel_life.memory_records SET source_ids=$3 WHERE owner_id=$1 AND id=$2',
        [derived.ownerId, existing.id, JSON.stringify(sources)],
      );
      await addSourceRefs(sql, String(existing.id), derived.ownerId, derived.scopeType, sources);
      summary.merged += 1;
      continue;
    }
    // Only replace the same scoped assertion class. Inference never replaces a user correction.
    if (derived.key && derived.status === 'active')
      await sql.query(
        `UPDATE parallel_life.memory_records SET status='superseded'
       WHERE owner_id=$1 AND scope_type=$2 AND scope_id=$3 AND key=$4 AND status='active'
       AND kind=$5 AND source_type=$6
       AND branch_id IS NOT DISTINCT FROM $7 AND character_id IS NOT DISTINCT FROM $8
       AND lower(btrim(regexp_replace(text, '\\s+', ' ', 'g'))) <> $9`,
        [
          derived.ownerId,
          derived.scopeType,
          derived.scopeId,
          derived.key,
          derived.kind,
          derived.sourceType,
          derived.branchId ?? null,
          derived.characterId ?? null,
          normalized,
        ],
      );
    await insertMemory(sql, derived);
    summary.created += 1;
  }
  return summary;
}

async function insertMemory(sql: SqlClient, record: MemoryRecord) {
  await sql.query(
    `INSERT INTO parallel_life.memory_records
        (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      record.id,
      record.ownerId,
      record.scopeType,
      record.scopeId,
      record.branchId ?? null,
      record.characterId ?? null,
      record.kind,
      record.text,
      record.key ?? null,
      record.sourceType,
      JSON.stringify(record.sourceIds),
      record.status,
      record.importance,
      record.createdAt,
    ],
  );
  await addSourceRefs(sql, record.id, record.ownerId, record.scopeType, record.sourceIds);
}

async function lockMemoryScope(
  sql: SqlClient,
  ownerId: string,
  scope: MemoryScope,
  scopeId: string,
) {
  await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    JSON.stringify(['memory', ownerId, scope, scopeId]),
  ]);
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
  playerVisibleOnly = false,
): Promise<MemoryRecord[]> {
  const rows = (
    await sql.query(
      `SELECT m.* FROM parallel_life.memory_records m WHERE m.owner_id=$1 ${playerVisibleOnly ? 'AND ' + PLAYER_MEMORY_PREDICATE : ''} FOR UPDATE`,
      [ownerId],
    )
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
    playerVisibleOnly?: boolean;
  },
): Promise<MemoryRecord> {
  await lockMemoryScope(sql, input.ownerId, input.scopeType, input.scopeId);
  const playerVisibleOnly = input.playerVisibleOnly ?? true;
  if (playerVisibleOnly && input.scopeType === 'character') throw new DomainError('FORBIDDEN');
  const { newRecord, supersededRecords } = correctMemory({
    ...input,
    ...(input.scopeType === 'branch' ? { branchId: input.scopeId } : {}),
    existingRecords: (await loadMemoryRecords(sql, input.ownerId, playerVisibleOnly)).filter(
      (record) =>
        record.scopeType === input.scopeType &&
        record.scopeId === input.scopeId &&
        record.characterId === input.characterId &&
        record.branchId === (input.scopeType === 'branch' ? input.scopeId : input.branchId),
    ),
  });
  for (const superseded of supersededRecords)
    await sql.query(
      "UPDATE parallel_life.memory_records SET status='superseded' WHERE owner_id=$1 AND id=$2",
      [input.ownerId, superseded.id],
    );
  await insertMemory(sql, newRecord);
  return newRecord;
}

/** The user saying "forget it": the record is forgotten, never deleted. */
export async function forgetMemoryInStore(
  sql: SqlClient,
  input: {
    ownerId: string;
    targetMemoryId: string;
    evidence?: Record<string, unknown>;
    playerVisibleOnly?: boolean;
  },
): Promise<MemoryRecord> {
  const records = await loadMemoryRecords(sql, input.ownerId, input.playerVisibleOnly ?? true);
  const target = records.find((record) => record.id === input.targetMemoryId);
  /* A missing memory is the caller's mistake, not an unavailable service. */
  if (!target) throw new DomainError('NOT_FOUND');
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

/** Player-readable memories, filtered before ordering/budget. Internal directors use loadWorldMemories. */
export async function listMemories(
  sql: SqlClient,
  ownerId: string,
  filter: {
    scopeType?: MemoryScope;
    scopeId?: string;
    characterId?: string;
    includeInactive?: boolean;
  } = {},
) {
  const rows = (
    await sql.query(
      `SELECT m.* FROM parallel_life.memory_records m
        WHERE owner_id=$1 AND ${PLAYER_MEMORY_PREDICATE}
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

/**
 * What one character may recall: its own records plus explicitly shared branch
 * records. A branch episode is the director's account of a turn and may contain
 * another person's private chat, so it is never delivered to an NPC. Sources belonging to
 * forgotten records are blocked so a forgotten memory cannot come back through the
 * message it came from.
 */
export async function loadActorMemories(
  sql: SqlClient,
  ownerId: string,
  params: { actorId: string; worldId: string },
): Promise<{ records: MemoryRecord[]; blockedSources: Set<string> }> {
  const rows = (
    await sql.query(
      `SELECT * FROM parallel_life.memory_records
        WHERE owner_id=$1
          AND scope_type IN ('character','branch')
          AND ((scope_type='character' AND character_id=$2) OR (scope_type='branch' AND scope_id=$3 AND kind<>'episode'))
        ORDER BY importance DESC, created_at DESC
        LIMIT 200`,
      [ownerId, params.actorId, params.worldId],
    )
  ).rows;
  const records: MemoryRecord[] = [];
  const blockedSources = new Set<string>();
  for (const row of rows) {
    const sources: string[] = Array.isArray(row.source_ids) ? row.source_ids : [];
    if (row.status === 'forgotten') {
      for (const source of sources) blockedSources.add(source);
      continue;
    }
    if (row.status !== 'active') continue;
    records.push(
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
        sourceIds: sources,
        status: row.status,
        importance: Number(row.importance),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }),
    );
  }
  return { records, blockedSources };
}

/** Every character's records plus this world's episodes, for agenda building. */
export async function loadWorldMemories(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
): Promise<MemoryRecord[]> {
  const rows = (
    await sql.query(
      `SELECT * FROM parallel_life.memory_records
        WHERE owner_id=$1 AND status='active'
          AND ((scope_type='character' AND branch_id=$2) OR (scope_type='branch' AND scope_id=$2))
        ORDER BY importance DESC, created_at DESC LIMIT 200`,
      [ownerId, worldId],
    )
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
 * Player reads have a stronger boundary than owner RLS. Internal branch summaries and
 * NPC beliefs are not made public merely because they cite a message/event.
 * Legacy branch text is admitted only when it is an exact excerpt of a saved player-visible item.
 */
export const PLAYER_MEMORY_PREDICATE = `(
  (m.scope_type='profile' AND m.character_id IS NULL)
  OR (m.scope_type='branch' AND m.character_id IS NULL AND m.branch_id=m.scope_id
    AND EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id=m.scope_id AND w.owner_id=m.owner_id)
    AND (
      (m.kind='correction' AND m.source_type='user_correction')
      OR (m.kind<>'summary' AND m.source_type IN ('world_event','user_statement') AND (
        EXISTS (
          SELECT 1 FROM parallel_life.world_messages p JOIN parallel_life.world_events e
          ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id AND e.owner_id=p.owner_id
          WHERE p.world_id=m.scope_id AND p.owner_id=m.owner_id
          AND (m.source_ids ? p.id OR m.source_ids ? e.id)
          AND m.text=left(p.document->>'text',400)
        )
        OR EXISTS (
          SELECT 1 FROM parallel_life.scene_items p JOIN parallel_life.world_events e
          ON e.id=p.source_event_id AND e.world_id=p.world_id AND e.owner_id=p.owner_id
          WHERE p.world_id=m.scope_id AND p.owner_id=m.owner_id AND p.kind='entry'
          AND m.source_ids ? p.source_event_id
          AND p.document->'observableTo' @> jsonb_build_array(jsonb_build_object('kind','player'))
          AND m.text=left(p.document->>'text',400)
        )
      ))
    ))
)`;

/** Used by public forgetting and branch-to-profile candidate conversion, including guessed IDs. */
export async function requirePlayerMemory(sql: SqlClient, ownerId: string, id: string) {
  const row = (
    await sql.query(
      `SELECT m.* FROM parallel_life.memory_records m WHERE m.owner_id=$1 AND m.id=$2 AND ${PLAYER_MEMORY_PREDICATE} FOR UPDATE`,
      [ownerId, id],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  return row;
}

export async function correctPlayerMemoryInStore(
  sql: SqlClient,
  input: Parameters<typeof correctMemoryInStore>[1],
) {
  if (input.scopeType === 'character') throw new DomainError('FORBIDDEN');
  return correctMemoryInStore(sql, {
    ...input,
    ...(input.scopeType === 'branch' ? { branchId: input.scopeId } : {}),
    playerVisibleOnly: true,
  });
}

export async function forgetPlayerMemoryInStore(
  sql: SqlClient,
  input: Parameters<typeof forgetMemoryInStore>[1],
) {
  await requirePlayerMemory(sql, input.ownerId, input.targetMemoryId);
  return forgetMemoryInStore(sql, { ...input, playerVisibleOnly: true });
}
