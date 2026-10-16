/** Manual, bounded public-HTTP evaluation. No automatic retries, no media operations.
 * Private session/CSRF live only in the ignored ledger. Evidence contains owned synthetic worlds.
 * Successful scene tasks call one director plus <=2 actual NPCs: reserve the proven upper bound.
 * Run only with fresh explicit human authorization and MATTER_EVAL_AUTHORIZED=1.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const base = 'https://parallel-life-nu.vercel.app';
const ledgerPath = process.env.MATTER_EVAL_LEDGER ?? '.local/matter-aiqa-private.json';
const evidenceDir = process.env.MATTER_EVAL_EVIDENCE ?? '.local/matter-aiqa-evidence';
const maxCalls = Number(process.env.MATTER_EVAL_MAX_CALLS ?? 12);
assert.ok([12, 18].includes(maxCalls), 'Use only an explicitly authorized cap');
const command = process.argv[2] ?? 'plan',
  preset = process.argv[3] ?? 'county-yellow-hair';
if (command === 'plan') {
  console.log({
    manual: true,
    maxWorlds: 2,
    maxReservedModelCalls: maxCalls,
    media: 0,
    flow: ['create', 'prepare', 'opening', 'action', 'reply', 'pause'],
    note: 'Scene budget includes separate director and NPC calls; no automatic retries.',
  });
  process.exit(0);
}
assert.equal(process.env.MATTER_EVAL_AUTHORIZED, '1', 'Fresh explicit authorization required');
await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
let ledger = JSON.parse(
  await readFile(ledgerPath, 'utf8').catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return JSON.stringify({ worlds: [], reservedModelCalls: 0, operations: [], evidence: [] });
  }),
);
if (ledger.budgetCap === undefined) {
  assert.ok(
    maxCalls === 12 || ledger.operations.length === 0,
    'Never extend a closed batch or reuse its remaining calls',
  );
  ledger.budgetCap = maxCalls;
}
assert.equal(ledger.budgetCap, maxCalls, 'Budget cap is immutable within the owned batch');
assert.ok(
  !ledger.closed || ['snapshot', 'summary', 'check-reply-receipt', 'pause'].includes(command),
  'Closed evaluation batch: do not reuse remaining authorization or resume paid work',
);
async function save() {
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
}
async function evidence(kind, data) {
  const name = `${String(ledger.evidence.length + 1).padStart(2, '0')}-${kind}.json`;
  await writeFile(evidenceDir + '/' + name, JSON.stringify(data, null, 2), { mode: 0o600 });
  ledger.evidence.push(name);
  await save();
}
async function api(path, body) {
  const method = body === undefined ? 'GET' : 'POST';
  const r = await fetch(base + path, {
    method,
    redirect: 'error',
    headers: {
      origin: base,
      ...(ledger.cookie ? { cookie: ledger.cookie } : {}),
      ...(ledger.csrfToken ? { 'x-csrf-token': ledger.csrfToken } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(125000),
  });
  const data = await r.json();
  if (!r.ok) {
    await evidence('http-rejection', { path, method, status: r.status, data });
    throw Error(`HTTP ${r.status} ${data.error?.code ?? 'UNKNOWN'}`);
  }
  return { data, response: r };
}
async function reserve(kind, calls, details) {
  assert.ok(
    ledger.reservedModelCalls + calls <= maxCalls,
    'Human budget exhausted; no request dispatched',
  );
  ledger.reservedModelCalls += calls;
  const op = {
    id: randomUUID(),
    kind,
    reservedCalls: calls,
    details,
    state: 'reserved',
    at: new Date().toISOString(),
  };
  ledger.operations.push(op);
  await save();
  return op;
}
const entry = () => {
  const w = ledger.worlds.find((w) => w.preset === preset);
  assert.ok(w, 'Create the owned world first');
  return w;
};
const prefix = (w) => '/api/v1/worlds/' + w.worldId;
async function snapshot(w, label) {
  const p = prefix(w);
  const [phone, records, scene, space, clock] = await Promise.all(
    [p, p + '/records', p + '/scenes', p + '/space', p + '/clock'].map((x) =>
      api(x).then((x) => x.data),
    ),
  );
  await evidence(label, { preset, phone, records, scene, space, clock });
  assert.ok(
    [records.worldVersion, scene.worldVersion, space.worldVersion].every(
      (version) => version === phone.version,
    ),
    'Mixed-version snapshot: retained as evidence, never treat it as one committed state',
  );
  return { phone, records, scene, space, clock };
}
async function runTask(w, task, opening) {
  assert.equal(task.status, 'queued', 'Never execute unknown/running/replayed tasks automatically');
  const view = (await api(prefix(w) + '/scenes')).data;
  let cap;
  if (opening) {
    const phone = (await api(prefix(w))).data;
    const ap = phone.invitations.find((a) => a.id === w.appointmentId);
    assert.ok(ap);
    const count = (ap.participantIds ?? []).length;
    assert.ok(count <= 2);
    cap = 1 + count;
  } else
    cap =
      1 +
      Math.min(
        2,
        view.scene.presence.filter(
          (p) => p.participant.kind === 'actor' && p.leftVersion === undefined,
        ).length,
      );
  const op = await reserve('scene-task', cap, { worldId: w.worldId, taskId: task.id, opening });
  try {
    const result = (await api('/api/v1/tasks/' + task.id + '/run', {})).data;
    op.state = result.status;
    op.model = result.model ?? null;
    op.promptVersion = result.promptVersion ?? null;
    await evidence('task-result', { preset, taskId: task.id, result, reservedUpperBound: cap });
    assert.equal(
      result.status,
      'succeeded',
      'Task rejected/failed: stop and review; never hide failure',
    );
  } catch (e) {
    if (op.state === 'reserved') op.state = 'unknown';
    throw e;
  } finally {
    await save();
  }
}
if (command === 'create') {
  assert.ok(!ledger.worlds.some((w) => w.preset === preset), 'Never create duplicate fixture');
  assert.ok(ledger.worlds.length < 2);
  if (!ledger.cookie) {
    const { data, response } = await api('/api/v1/session', {});
    const cookie = response.headers.get('set-cookie')?.match(/pl_session=([^;]+)/)?.[1];
    assert.ok(cookie);
    ledger.cookie = 'pl_session=' + cookie;
    ledger.csrfToken = data.csrfToken;
    await save();
  }
  const result = (
    await api('/api/v1/official-lives/' + preset + '/start', {
      commandId: randomUUID(),
      version: 3,
    })
  ).data;
  assert.equal(result.resumed, false);
  ledger.worlds.push({ preset, worldId: result.worldId });
  await save();
  await snapshot(entry(), 'created');
} else if (command === 'prepare') {
  const w = entry();
  await api(prefix(w) + '/clock', { paused: false, speed: 0 });
  const s = await snapshot(w, 'before-prepare');
  const target = s.records.current.find(
    (r) =>
      r.span === 'near_term' &&
      r.title === (preset === 'county-yellow-hair' ? '交付已修缮的R17' : '湖边与顾遥见面'),
  );
  assert.ok(target, 'Review real public title before selecting; do not invent IDs');
  w.matterId = target.source.matterId;
  const invitationId =
    target.navigation?.invitationId ??
    target.relatedLinks?.find((l) => l.app === 'calendar')?.target;
  assert.ok(invitationId);
  w.appointmentId = invitationId;
  const ap = s.phone.invitations.find((a) => a.id === invitationId);
  assert.ok(ap);
  const place = s.space.places.find((p) => p.appointmentIds.includes(ap.id));
  assert.ok(place);
  w.placeId = place.id;
  w.actorId = ap.participantIds[0];
  await save();
  if (Date.parse(ap.at) < Date.parse(s.clock.storyNow)) {
    const r = (
      await api(prefix(w) + '/invitations', {
        commandId: randomUUID(),
        expectedVersion: s.phone.version,
        id: ap.id,
        operation: 'reschedule',
        at: new Date(Date.parse(s.clock.storyNow) + 60000).toISOString(),
      })
    ).data;
    ap.at = r.invitation.at;
    ap.status = r.invitation.status;
    s.phone.version = r.version;
    await evidence('explicit-test-reschedule', {
      preset,
      originalAppointmentId: ap.id,
      newAt: ap.at,
      reason: 'Original one-minute invite expired before confirmation; no silent fake attendance',
    });
  }
  if (ap.status === 'proposed')
    await api(prefix(w) + '/invitations', {
      commandId: randomUUID(),
      expectedVersion: s.phone.version,
      id: ap.id,
      operation: 'accept',
    });
  let space = (await api(prefix(w) + '/space')).data;
  if (space.currentPlaceId !== place.id) {
    const route = space.routes.find(
      (r) => r.fromPlaceId === space.currentPlaceId && r.toPlaceId === place.id,
    );
    assert.ok(route);
    await api(prefix(w) + '/space/travel', {
      commandId: randomUUID(),
      expectedVersion: space.worldVersion,
      routeId: route.id,
    });
  }
  const clock = (await api(prefix(w) + '/clock')).data;
  const gap = Date.parse(ap.at) - Date.parse(clock.storyNow);
  await api(prefix(w) + '/clock', { paused: false, speed: gap > 0 ? 60 : 0 });
  await evidence('prepare', {
    preset,
    worldId: w.worldId,
    minutesUntilAppointment: Math.max(0, gap / 60000),
    testOnlyClockSpeed: gap > 0 ? 60 : 0,
  });
} else if (command === 'leave') {
  const w = entry(),
    s = await snapshot(w, 'before-explicit-leave');
  assert.equal(s.scene.scene?.id, w.sceneId);
  assert.ok(!['queued', 'running', 'unknown'].includes(s.scene.task?.status));
  await api(prefix(w) + '/scenes/' + w.sceneId + '/leave', {
    commandId: randomUUID(),
    expectedVersion: s.phone.version,
  });
  await snapshot(w, 'explicit-leave-saved');
} else if (command === 'opening') {
  const w = entry();
  await api(prefix(w) + '/clock', { paused: false, speed: 0 });
  const phone = (await api(prefix(w))).data,
    ap = phone.invitations.find((a) => a.id === w.appointmentId),
    clock = (await api(prefix(w) + '/clock')).data;
  assert.ok(
    Date.parse(ap.at) <= Date.parse(clock.storyNow),
    'Future appointment: wait, do not change time in database',
  );
  const receipt = (
    await api(prefix(w) + '/scenes', {
      commandId: randomUUID(),
      expectedVersion: phone.version,
      appointmentId: w.appointmentId,
    })
  ).data;
  w.sceneId = receipt.sceneId;
  await save();
  await runTask(w, receipt.task, true);
  await snapshot(w, 'opening-saved');
} else if (command === 'action') {
  const w = entry(),
    s = await snapshot(w, 'before-action');
  const requestedTitle = process.env.MATTER_EVAL_TITLE;
  assert.ok(requestedTitle && process.env.MATTER_EVAL_TEXT, 'Manual chosen title/text required');
  const m = s.scene.matters.find((m) => m.title === requestedTitle);
  assert.ok(m, 'Use saved scene matter ID only');
  const input = {
    commandId: randomUUID(),
    expectedVersion: s.phone.version,
    text: process.env.MATTER_EVAL_TEXT,
    relatedMatterIds: [m.id],
  };
  await evidence('action-input', { preset, worldId: w.worldId, sceneId: w.sceneId, input });
  const receipt = (await api(prefix(w) + '/scenes/' + w.sceneId + '/actions', input)).data;
  await runTask(w, receipt.task, false);
  await snapshot(w, 'action-saved');
} else if (command === 'replay-action') {
  const w = entry(),
    before = await snapshot(w, 'before-action-replay');
  const name = ledger.evidence.findLast((n) => n.endsWith('-action-input.json'));
  assert.ok(name);
  const original = JSON.parse(await readFile(evidenceDir + '/' + name, 'utf8'));
  assert.equal(original.worldId, w.worldId);
  const receipt = (
    await api(prefix(w) + '/scenes/' + original.sceneId + '/actions', original.input)
  ).data;
  assert.equal(receipt.commandId, original.input.commandId);
  assert.equal(receipt.task.status, 'succeeded');
  const after = await snapshot(w, 'after-action-replay');
  assert.equal(before.phone.version, after.phone.version);
  assert.deepEqual(before.scene.actions, after.scene.actions);
  assert.deepEqual(before.scene.matters, after.scene.matters);
  await evidence('action-replay-proof', {
    modelCalls: 0,
    comparedProjectionsUnchanged: true,
    eventCountVerified: false,
    beforeVersion: before.phone.version,
    afterVersion: after.phone.version,
  });
} else if (command === 'retry-reviewed-scene') {
  // Manual invocation only: preserve uncertain spend, inspect the original receipt,
  // then reserve another complete upper bound. Never retry in an automatic loop.
  const w = entry();
  const old = ledger.operations.at(-1);
  assert.equal(old?.kind, 'scene-task');
  assert.ok(['unknown', 'failed'].includes(old.state));
  assert.equal(old.details.worldId, w.worldId);
  assert.ok(ledger.reservedModelCalls + old.reservedCalls <= maxCalls);
  const original = (await api('/api/v1/tasks/' + old.details.taskId)).data;
  assert.equal(original.status, old.state, 'Read back the original task before deliberate retry');
  assert.ok(['unknown', 'failed'].includes(original.status));
  assert.equal(original.resultVersion, null, 'Never retry a committed result');
  await evidence('manual-retry-reviewed', { preset, original, uncertainSpendRetained: true });
  const task = (await api('/api/v1/tasks/' + original.id + '/retry', { commandId: randomUUID() }))
    .data;
  await runTask(w, task, old.details.opening);
  await snapshot(w, 'retry-saved');
} else if (command === 'reply') {
  const w = entry(),
    s = await snapshot(w, 'before-reply');
  assert.ok(process.env.MATTER_EVAL_TEXT);
  const input = {
    commandId: randomUUID(),
    expectedVersion: s.phone.version,
    actorId: w.actorId,
    text: process.env.MATTER_EVAL_TEXT,
  };
  const op = await reserve('phone-reply', 1, { worldId: w.worldId, commandId: input.commandId });
  await evidence('reply-input', { preset, worldId: w.worldId, input });
  try {
    const result = (await api(prefix(w) + '/messages', input)).data;
    op.state = 'committed';
    await evidence('reply-receipt', { preset, result });
    await snapshot(w, 'reply-saved');
  } catch (e) {
    // A later read failure does not undo the already returned commit receipt.
    if (op.state !== 'committed') op.state = 'unknown';
    throw e;
  } finally {
    await save();
  }
} else if (command === 'check-reply-receipt') {
  const w = entry();
  const name = ledger.evidence.findLast((n) => n.endsWith('-reply-input.json'));
  assert.ok(name, 'Inspect only the original owned reply');
  const original = JSON.parse(await readFile(evidenceDir + '/' + name, 'utf8'));
  assert.equal(original.worldId, w.worldId);
  const receipt = (await api(prefix(w) + '/messages/receipt', original.input)).data;
  await evidence('reply-receipt-readonly', { preset, receipt, modelCalls: 0 });
} else if (command === 'pause') {
  for (const w of ledger.worlds) {
    await api(prefix(w) + '/clock', { paused: true, speed: 0 });
    const c = (await api(prefix(w) + '/clock')).data;
    assert.equal(c.paused, true);
    w.paused = true;
  }
  ledger.closed = true;
  ledger.closedAt = new Date().toISOString();
  await save();
  await evidence('paused', {
    worlds: ledger.worlds.map((w) => ({ preset: w.preset, paused: w.paused })),
    reservedModelCalls: ledger.reservedModelCalls,
  });
} else if (command === 'snapshot') {
  await snapshot(entry(), 'read-only');
} else if (command === 'summary') {
  console.log({
    worlds: ledger.worlds.length,
    reservedModelCalls: ledger.reservedModelCalls,
    maximum: maxCalls,
    operations: ledger.operations.map((o) => ({
      kind: o.kind,
      reservedCalls: o.reservedCalls,
      state: o.state,
    })),
    allPaused: ledger.worlds.every((w) => w.paused === true),
  });
  process.exit(0);
} else throw Error('Unknown manual phase');
console.log({
  phase: command,
  preset,
  worlds: ledger.worlds.length,
  reservedModelCalls: ledger.reservedModelCalls,
  evidenceFiles: ledger.evidence.length,
});
