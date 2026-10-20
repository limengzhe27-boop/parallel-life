import { isAdmittedAgentCommitHead } from './agent-commit-version.ts';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  AuthoredMaterialError,
  authoredMaterialCanonicalJson,
  compileAuthoredAgentMaterials,
  type AuthoredAgentMaterial,
  type AuthoredAgentMaterialCatalog,
  type AuthoredMaterialRef,
  type AuthoredMaterialSourceDocument,
  type AuthoredMaterialSourceRef,
} from '../domain/authored-agent-material.ts';

/** Explicit full-text transfer budget; index_only always means the full material was not returned. */
export const AUTHORED_MATERIAL_DEFAULT_MAX_BYTES = 64000;
const MAX_BYTES = 2000000;
export type AuthoredMaterialReadRequest = {
  worldId: string;
  expectedEngineEpoch: number;
  expectedWorldVersion: number;
  /** Revalidation only: requires a live transaction-scoped admission for this actor. */
  commitActorId?: string;
  expectedSource?: AuthoredMaterialSourceRef;
  maxBytes?: number;
};
export type AuthoredMaterialIndex = Omit<AuthoredAgentMaterial, 'node'> & {
  title: string;
  nodeBytes: number;
};
export type AuthoredMaterialCatalogRead =
  | {
      status: 'complete';
      catalog: AuthoredAgentMaterialCatalog;
      requiredBytes: number;
      maxBytes: number;
    }
  | {
      status: 'index_only';
      header: Omit<AuthoredAgentMaterialCatalog, 'materials'>;
      index: AuthoredMaterialIndex[];
      requiredBytes: number;
      indexBytes: number;
      maxBytes: number;
    };
export type AuthoredMaterialByKeyRead =
  | { status: 'complete'; material: AuthoredAgentMaterial; requiredBytes: number; maxBytes: number }
  | { status: 'over_budget'; ref: AuthoredMaterialRef; requiredBytes: number; maxBytes: number };
const fail = (code: string): never => {
  throw new AuthoredMaterialError(code);
};
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const bytes = (v: unknown) => Buffer.byteLength(authoredMaterialCanonicalJson(v), 'utf8');
function budget(input: AuthoredMaterialReadRequest) {
  const max = input.maxBytes ?? AUTHORED_MATERIAL_DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_BYTES)
    fail('AUTHORED_MATERIAL_INVALID_BUDGET');
  return max;
}
/**
 * Only SELECT on the caller's SqlClient. A single statement gives a coherent world/epoch/source
 * even at READ COMMITTED; snapshot readers may reuse their existing RR/READ ONLY transaction.
 * No BEGIN/role change/new connection/old progress initialization/model call.
 */
async function catalog(
  sql: SqlClient,
  ownerId: string,
  input: AuthoredMaterialReadRequest,
): Promise<AuthoredAgentMaterialCatalog> {
  if (
    !ownerId ||
    !input.worldId ||
    !Number.isSafeInteger(input.expectedEngineEpoch) ||
    input.expectedEngineEpoch < 2 ||
    !Number.isSafeInteger(input.expectedWorldVersion) ||
    input.expectedWorldVersion < 0
  )
    fail('INVALID_AUTHORED_MATERIAL_SCOPE');
  const row = (
    await sql.query(
      `SELECT w.id,w.version,COALESCE(c.engine_epoch,1) AS epoch,current_setting('app.user_id',true) AS identity,
    COALESCE((SELECT jsonb_agg(a->>'id') FROM jsonb_array_elements(w.state->'actors') a),'[]'::jsonb) AS actor_ids,
    COALESCE((SELECT jsonb_agg(p->>'id') FROM jsonb_array_elements(coalesce(w.state->'space'->'places','[]'::jsonb)) p),'[]'::jsonb) AS place_ids,
    parallel_life.publication_story_source(w.id) AS source
    FROM parallel_life.worlds w LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
    WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (!row) fail('NOT_FOUND');
  if (row.identity !== ownerId) fail('AUTHORED_MATERIAL_OWNER_SCOPE');
  if (Number(row.epoch) !== input.expectedEngineEpoch) fail('ENGINE_EPOCH_CONFLICT');
  if (
    Number(row.version) !== input.expectedWorldVersion &&
    !(
      input.commitActorId &&
      (await isAdmittedAgentCommitHead(
        sql,
        ownerId,
        input.worldId,
        input.commitActorId,
        input.expectedWorldVersion,
        Number(row.version),
      ))
    )
  )
    fail('VERSION_CONFLICT');
  const result = compileAuthoredAgentMaterials(
    {
      scope: {
        worldId: input.worldId,
        engineEpoch: Number(row.epoch),
        worldVersion: input.expectedWorldVersion,
      },
      source: row.source as AuthoredMaterialSourceDocument | null,
      actualActorIds: row.actor_ids,
      actualPlaceIds: row.place_ids,
    },
    hash,
  );
  if (
    input.expectedSource &&
    authoredMaterialCanonicalJson(result.source) !==
      authoredMaterialCanonicalJson(input.expectedSource)
  )
    fail('AUTHORED_MATERIAL_SOURCE_CONFLICT');
  return result;
}
export async function readAuthoredAgentMaterialCatalog(
  sql: SqlClient,
  ownerId: string,
  input: AuthoredMaterialReadRequest,
): Promise<AuthoredMaterialCatalogRead> {
  const maxBytes = budget(input),
    full = await catalog(sql, ownerId, input),
    requiredBytes = bytes(full);
  if (requiredBytes <= maxBytes)
    return { status: 'complete', catalog: full, requiredBytes, maxBytes };
  const { materials, ...header } = full;
  const index = materials.map(({ node, ...entry }): AuthoredMaterialIndex => ({
    ...entry,
    title: node.title,
    nodeBytes: bytes(node),
  }));
  // Index size is explicit too. This is evidence retrieval, never a claim that the index fits an LLM budget.
  return {
    status: 'index_only',
    header,
    index,
    requiredBytes,
    indexBytes: bytes({ header, index }),
    maxBytes,
  };
}
/** Exact frozen source+node hash is mandatory; a key alone cannot address a different publication. */
export async function readAuthoredAgentMaterialByKey(
  sql: SqlClient,
  ownerId: string,
  input: Omit<AuthoredMaterialReadRequest, 'expectedSource'> & { ref: AuthoredMaterialRef },
): Promise<AuthoredMaterialByKeyRead | null> {
  const maxBytes = budget(input);
  if (
    !input.ref ||
    input.ref.source.worldId !== input.worldId ||
    !input.ref.nodeKey ||
    !/^[a-f0-9]{64}$/.test(input.ref.nodeHash)
  )
    fail('AUTHORED_MATERIAL_SOURCE_CONFLICT');
  const full = await catalog(sql, ownerId, { ...input, expectedSource: input.ref.source });
  const matches = full.materials.filter((m) => m.ref.nodeKey === input.ref.nodeKey);
  if (!matches.length) return null;
  if (matches.length !== 1) fail('AUTHORED_MATERIAL_AMBIGUOUS_KEY');
  const material = matches[0]!;
  if (material.ref.nodeHash !== input.ref.nodeHash) fail('AUTHORED_MATERIAL_NODE_CONFLICT');
  const requiredBytes = bytes(material);
  return requiredBytes <= maxBytes
    ? { status: 'complete', material, requiredBytes, maxBytes }
    : { status: 'over_budget', ref: material.ref, requiredBytes, maxBytes };
}
