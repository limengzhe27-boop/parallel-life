import path from 'node:path';

/** Operational clone manifest only. This adds no world state or queue schema. */
export function validateLocalWorkerEnvironment(env, manifest, local) {
  const target = manifest?.target;
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.preserveUnknown !== true ||
    !['127.0.0.1', 'localhost'].includes(target?.host) ||
    !Number.isInteger(target?.port) ||
    target.port < 1024 ||
    target.port > 65535 ||
    !/^parallel_life_clone_[a-zA-Z0-9_]+$/.test(target?.database ?? '') ||
    !Array.isArray(manifest.excludedTaskIds) ||
    !Array.isArray(manifest.excludedOutboxIds) ||
    !manifest.excludedTaskIds.every((x) => typeof x === 'string' && x.length > 0) ||
    !manifest.excludedOutboxIds.every((x) => typeof x === 'string' && x.length > 0) ||
    !Number.isFinite(Date.parse(manifest.capturedAt))
  )
    throw Error('LOCAL_CLONE_MANIFEST_REQUIRED');
  if (
    local?.port !== target.port ||
    typeof local?.adminPassword !== 'string' ||
    !local.adminPassword
  )
    throw Error('LOCAL_CLONE_ADMIN_CONFIGURATION_MISMATCH');
  for (const [key, value] of Object.entries(env)) {
    if (value && /^(SUPABASE_|BLOB_|VERCEL)/.test(key))
      throw Error('LOCAL_WORKER_CLOUD_STORAGE_FORBIDDEN');
  }
  const databases = [
    ['DATABASE_URL', 'pl_app'],
    ['WORKER_DATABASE_URL', 'pl_worker'],
  ];
  if (env.SCHEDULER_DATABASE_URL) databases.push(['SCHEDULER_DATABASE_URL', 'pl_scheduler']);
  for (const [key, role] of databases) {
    let url;
    try {
      url = new URL(env[key]);
    } catch {
      throw Error('LOCAL_WORKER_DATABASE_REQUIRED');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      Number(url.port) !== target.port ||
      url.pathname !== `/${target.database}` ||
      decodeURIComponent(url.username) !== role ||
      url.search !== ''
    )
      throw Error('LOCAL_WORKER_DATABASE_MISMATCH');
  }
  if (env.APP_DATABASE_URL && env.APP_DATABASE_URL !== env.DATABASE_URL)
    throw Error('LOCAL_WORKER_DATABASE_MISMATCH');
  if (!env.PRIVATE_ASSET_DIR || !path.isAbsolute(env.PRIVATE_ASSET_DIR))
    throw Error('LOCAL_WORKER_PRIVATE_STORAGE_REQUIRED');
  return {
    target,
    excludedTaskIds: [...new Set(manifest.excludedTaskIds)],
    excludedOutboxIds: [...new Set(manifest.excludedOutboxIds)],
  };
}

/** Administrator access is read-only discovery; execution keeps original owner-scoped ports. */
export async function selectNewTask(sql, manifest, kinds, excludedCommands) {
  return (
    (
      await sql.query(
        `SELECT id,owner_id FROM parallel_life.tasks
    WHERE status='queued' AND scope_kind=ANY($1::text[])
      AND NOT(id::text=ANY($2::text[])) AND NOT(command_id::text=ANY($3::text[]))
    ORDER BY created_at,id LIMIT 1`,
        [kinds, manifest.excludedTaskIds, excludedCommands],
      )
    ).rows[0] ?? null
  );
}

export async function selectNewOutboxEvents(sql, manifest) {
  return (
    await sql.query(
      `SELECT j.owner_id,j.world_id,j.event_id,min(j.created_at) AS created_at
    FROM parallel_life.outbox_jobs j WHERE j.status='queued'
      AND NOT(j.id=ANY($1::text[]))
      AND NOT EXISTS(SELECT 1 FROM parallel_life.outbox_jobs old
        WHERE old.world_id=j.world_id AND old.owner_id=j.owner_id AND old.event_id=j.event_id
          AND old.id=ANY($1::text[]))
    GROUP BY j.owner_id,j.world_id,j.event_id ORDER BY min(j.created_at),j.event_id LIMIT 2`,
      [manifest.excludedOutboxIds],
    )
  ).rows;
}
