import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as contract from '../src/contracts/world-interaction.ts';
import { Id } from '../src/contracts/api.ts';
import { LifeClient } from '../src/features/api/client.ts';
import {
  toContractStreamSummary,
  type CommittedStreamSegmentEvent,
} from '../src/modules/world/domain/npc-stream-segment.ts';

const source = await readFile(
  new URL('../src/server/world-message-http.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const interrupted of [false, true]) {
  test(`actual native event reaches strict browser client before final turn (${interrupted ? 'interrupted' : 'completed'})`, async () => {
    const worldId = randomUUID(),
      actorId = randomUUID(),
      commandId = randomUUID(),
      eventId = randomUUID();
    const at = '2026-10-26T08:00:00.000Z';
    const raw: CommittedStreamSegmentEvent = {
      status: 'segment_committed',
      worldId,
      actorId,
      commandId,
      eventId,
      attemptId: randomUUID(),
      segmentIndex: 0,
      segmentId: 'unit-0',
      version: 1,
      unitKind: 'independent_statement',
      message: {
        id: `${eventId}_seg_0`,
        actorId,
        role: 'assistant',
        text: '我先自己吃，你忙你的。',
        at,
        sourceEventId: eventId,
        sourceVersion: 1,
      },
      userMessage: {
        id: `${eventId}_user`,
        actorId,
        role: 'user',
        text: '不用等我吃饭。',
        at,
        sourceEventId: eventId,
        sourceVersion: 1,
      },
    };
    const unchanged = structuredClone(raw);
    // This is the kernel event shape, intentionally not a handcrafted client DTO.
    assert.equal(contract.CommittedStreamSegmentEventSchema.safeParse(raw).success, false);
    let release!: () => void;
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delivered!: () => void;
    const first = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let sends = 0,
      requests = 0,
      settled = false;
    const ports = {
      ...contract,
      Id,
      toContractStreamSummary,
      after: () => {},
      runCommittedChatMedia: async () => {},
      endpoint: (run: (context: object) => Promise<Response>) => run({ requestId: randomUUID() }),
      authenticated: async () => ({
        db: {},
        ownerId: randomUUID(),
        npcAgents: {
          sendMessageIfEnabled: async (
            _owner: string,
            _command: unknown,
            options: { onSegment: (s: CommittedStreamSegmentEvent) => void },
          ) => {
            sends++;
            options.onSegment(raw);
            await finish;
            if (interrupted) throw Error('FIXTURE_AFTER_COMMITTED_PREFIX');
            return { status: 'committed', worldId, actorId, commandId, eventId, version: 1 };
          },
        },
      }),
      parseBody: async (request: Request, schema: { parse: (x: unknown) => unknown }) =>
        schema.parse(await request.json()),
      NpcMessageError: class extends Error {},
      httpFailureResponse: () =>
        Response.json({ error: { code: 'UNAVAILABLE', message: '后续回应未完成。' } }),
    };
    const exports: { worldMessageRoute?: (request: Request, world: string) => Promise<Response> } =
      {};
    new Function('require', 'exports', compiled)(() => ports, exports);
    const client = new LifeClient(async (url, init) => {
      requests++;
      if (String(url).endsWith('/session'))
        return Response.json({ kind: 'guest', csrfToken: 'fixture-csrf-token-0000000000000000' });
      return exports.worldMessageRoute!(new Request('https://fixture.local' + url, init), worldId);
    });
    const segments: contract.CommittedStreamSegmentEventContract[] = [];
    const pending = client.sendWorldMessage(
      worldId,
      { commandId, actorId, text: raw.userMessage!.text, expectedVersion: 0 },
      {
        onSegment(segment) {
          segments.push(segment);
          delivered();
        },
      },
    );
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.race([
      first,
      pending.then(() => {
        throw Error('Turn settled before first committed unit');
      }),
    ]);
    assert.equal(settled, false, 'a real committed bubble is delivered before final receipt');
    assert.equal(segments[0]!.status, 'committed');
    assert.equal(
      segments[0]!.completionStatus,
      'streaming',
      'prefix is never advertised as complete',
    );
    assert.equal(segments[0]!.message.id, raw.message.id);
    assert.equal(segments[0]!.userMessage?.id, raw.userMessage!.id);
    assert.deepEqual(raw, unchanged, 'transport does not rewrite kernel evidence');
    release();
    if (interrupted) await assert.rejects(pending, { code: 'UNAVAILABLE' });
    else {
      const receipt = await pending;
      assert.equal(receipt.status, 'committed');
      assert.equal(
        receipt.streamSummary?.completionStatus,
        'streaming',
        'absent authoritative summary cannot invent completed',
      );
    }
    assert.equal(segments.length, 1);
    assert.equal(sends, 1);
    assert.equal(requests, 2, 'session and original send only; no recovery or retry');
  });
}
