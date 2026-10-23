import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual HTTP route with infrastructure ports replaced; no network/model calls.
const source = await readFile(
  new URL('../src/server/world-message-http.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const finalEvent of ['final-event', 'media-event']) {
  test(`non-stream committed media prefix wakes once before final receipt ${finalEvent}`, async () => {
    const calls: string[] = [];
    const retained: Array<() => Promise<void>> = [];
    const receipt = { status: 'committed', eventId: finalEvent };
    const ports = {
      after: (work: () => Promise<void>) => retained.push(work),
      runCommittedChatMedia: async (_db: unknown, owner: string, world: string, event: string) => {
        assert.equal(owner, 'owner');
        assert.equal(world, 'world');
        calls.push(event);
      },
      authenticated: async () => ({
        db: {},
        ownerId: 'owner',
        npcAgents: {
          sendMessageIfEnabled: async (
            _owner: string,
            _input: unknown,
            options: { onMediaCommitted: (id: string) => void },
          ) => {
            options.onMediaCommitted('media-event');
            options.onMediaCommitted('media-event');
            assert.deepEqual(
              calls,
              ['media-event'],
              'wake happens while the turn is still in progress',
            );
            return receipt;
          },
        },
      }),
      endpoint: async (run: (context: object) => Promise<unknown>) => run({}),
      parseBody: async () => ({
        commandId: 'command',
        actorId: 'actor',
        expectedVersion: 0,
        text: 'photo',
      }),
      Id: { safeParse: (id: string) => ({ success: true, data: id }) },
      WorldMessageReceiptSchema: { parse: (value: unknown) => value },
      worldMessageClientReceipt: (value: unknown) => value,
      json: (value: unknown) => Response.json(value),
      WORLD_MESSAGE_STREAM_HEADER: 'x-message-stream',
      WORLD_MESSAGE_STREAM_VERSION: '1',
      WORLD_MESSAGE_PROJECTION_HEADER: 'x-message-receipt-projection',
      WORLD_MESSAGE_PROJECTION_VERSION: '2',
      NpcMessageError: class extends Error {},
    };
    const exports: { worldMessageRoute?: (request: Request, world: string) => Promise<Response> } =
      {};
    new Function('require', 'exports', compiled)(() => ports, exports);
    const result = await exports.worldMessageRoute!(
      new Request('https://example.test/messages', { method: 'POST' }),
      'world',
    );
    assert.deepEqual(await result.json(), receipt);
    await Promise.all(retained.map((run) => run()));
    assert.deepEqual(
      calls,
      finalEvent === 'media-event' ? ['media-event'] : ['media-event', 'final-event'],
    );
    assert.equal(
      retained.length,
      calls.length,
      'each execution is retained within the request lifetime',
    );
  });
}
