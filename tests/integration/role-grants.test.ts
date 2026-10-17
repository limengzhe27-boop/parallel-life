import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';

/**
 * Guard against a repeat of the 2026-09-24 regression: a hardening migration revoked
 * EXECUTE from PUBLIC and no role could run the trigger/CHECK helpers any more, so
 * ordinary writes (interview answers, memory candidates) failed on the server.
 *
 * Permissions are classified explicitly: CHECK/caller helpers keep writer access,
 * while restricted table triggers need no direct app/worker EXECUTE grant.
 * Private authoring tables deliberately grant no access to the background worker.
 */
test('trigger helpers allow their writers; private authoring stays inaccessible to workers', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  try {
    const rows = (
      await admin.query(`
        SELECT DISTINCT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
               pg_get_function_result(p.oid) AS result_type,
               has_function_privilege('pl_app', p.oid, 'EXECUTE') AS app_ok,
               has_function_privilege('pl_worker', p.oid, 'EXECUTE') AS worker_ok
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE n.nspname = 'parallel_life' AND NOT t.tgisinternal
         ORDER BY p.proname`)
    ).rows;
    assert.ok(rows.length > 0, 'expected at least one trigger on runtime tables');
    const authorOnly = new Set([
      'guard_setting_draft_update',
      'guard_setting_revision',
      'guard_setting_revision_delete',
    ]);
    for (const row of rows.filter((row) => authorOnly.has(row.proname))) {
      assert.equal(row.app_ok, true);
      assert.equal(row.worker_ok, false);
    }
    for (const table of ['setting_drafts', 'setting_draft_revisions', 'setting_draft_receipts']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const access = await admin.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [
          'pl_worker',
          `parallel_life.${table}`,
          privilege,
        ]);
        assert.equal(access.rows[0].allowed, false);
      }
    }
    // These restricted triggers are invoked by table writes, never directly by runtime roles.
    const triggerOnly = new Set([
      'guard_agent_episode_evidence',
      'binding_current_avatar_sync',
      'profile_current_avatar_sync',
      'protect_current_avatar_asset',
      'publication_bridge_immutable',
      'publication_admission_consumed',
      'publication_seed_binding',
      'publication_story_immutable',
      'publication_story_node_identity',
      'publication_story_node_source',
      'publication_story_followup_source',
      'publisher_preparation_transition',
      // Source/event provenance and immutable authoring media are enforced by table writes.
      'publication_media_binding_guard',
      'publication_media_update',
      'publication_media_version_guard',
      'publication_scene_binding_guard',
      'publication_scene_version_guard',
      'publication_story_progress_evidence_guard',
      // Agent/director guards are table triggers, never callable execution capabilities.
      'agent_epoch_monotonic',
      'agent_native_group_finish_guard',
      'agent_runtime_immutable',
      'agent_attempt_identity_fence',
      'guard_agent_world_epoch',
      'guard_director_attempt',
      'guard_director_episode_origin',
      'guard_npc_journey',
      'guard_agent_narrative_admission',
      'guard_agent_episode_request',
      'guard_agent_episode_receipt',
      'guard_agent_episode_progress',
      'guard_agent_episode_outcome',
      'guard_player_episode_binding',
    ]);
    assert.equal(rows.filter((row) => triggerOnly.has(row.proname)).length, triggerOnly.size);
    for (const row of rows.filter((row) => triggerOnly.has(row.proname))) {
      assert.equal(row.result_type, 'trigger', `${row.proname} must remain a table trigger`);
      assert.equal(row.app_ok, false, `pl_app must not directly execute ${row.proname}`);
      assert.equal(row.worker_ok, false, `pl_worker must not directly execute ${row.proname}`);
    }
    // Employee publication writes use a separate restricted role. Neither
    // consumer requests nor background workers may call these helpers.
    const staffOnly = new Set([
      'publication_immutable',
      'publication_work_update',
      'publication_version_insert',
    ]);
    assert.equal(rows.filter((row) => staffOnly.has(row.proname)).length, staffOnly.size);
    for (const row of rows.filter((row) => staffOnly.has(row.proname))) {
      assert.equal(row.app_ok, false);
      assert.equal(row.worker_ok, false);
      const access = await admin.query('SELECT has_function_privilege($1,$2,$3) AS allowed', [
        'pl_publisher',
        `parallel_life.${row.proname}(${row.args})`,
        'EXECUTE',
      ]);
      assert.equal(access.rows[0].allowed, true);
    }
    const denied = rows.filter(
      (row) =>
        !authorOnly.has(row.proname) &&
        !triggerOnly.has(row.proname) &&
        !staffOnly.has(row.proname) &&
        (!row.app_ok || !row.worker_ok),
    );
    assert.deepEqual(
      denied.map((row) => `${row.proname}(${row.args}) app=${row.app_ok} worker=${row.worker_ok}`),
      [],
    );
  } finally {
    await admin.end();
  }
});

/** The CHECK helpers the runtime relies on must be executable too. */
test('check helpers used by runtime tables are executable by both runtime roles', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  try {
    for (const signature of ['parallel_life.is_jsonb_string_array(jsonb)']) {
      for (const role of ['pl_app', 'pl_worker']) {
        const ok = (
          await admin.query('SELECT has_function_privilege($1,$2,$3) AS ok', [
            role,
            signature,
            'EXECUTE',
          ])
        ).rows[0].ok;
        assert.equal(ok, true, `${role} must be able to execute ${signature}`);
      }
    }
  } finally {
    await admin.end();
  }
});
