import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { nativeAgentProjectionId } from '../src/modules/world/infrastructure/agent-channel-projector.ts';

test('native message and scene entry identifiers are stable UUIDs scoped by event/channel/index', () => {
  const event = '0c954ac8-e8df-4f49-8f11-189926046d97';
  const values = new Set<string>();
  for (const channel of ['group', 'scene'] as const)
    for (let i = 0; i < 8; i++) {
      const id = nativeAgentProjectionId(event, channel, i);
      assert.equal(z.uuid().parse(id), id);
      assert.equal(nativeAgentProjectionId(event, channel, i), id);
      assert(!values.has(id));
      values.add(id);
    }
});
