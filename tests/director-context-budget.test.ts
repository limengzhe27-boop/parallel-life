import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_BUDGET,
  fitWithinBudget,
} from '../src/modules/world/infrastructure/director-agent-model.ts';

const big = (n: number, size: number) => Array.from({ length: n }, () => 'x'.repeat(size));

test('大世界不再直接报错，而是裁到预算内', () => {
  const payload = {
    focus: 'keep-me',
    blockers: ['keep-blocker'],
    observations: big(40, 2000),
    episodes: big(30, 2000),
    candidates: big(30, 2000),
    changes: big(30, 2000),
    cast: [{ id: 'a', name: '青青', persona: 'p'.repeat(1500) }],
    worldSetting: 'w'.repeat(4000),
  };
  const fitted = fitWithinBudget(payload);
  assert.ok(JSON.stringify(fitted).length <= CONTEXT_BUDGET, '必须进入预算');
  assert.equal(fitted.focus, 'keep-me');
  assert.deepEqual(fitted.blockers, ['keep-blocker']);
  assert.ok((fitted.observations as unknown[]).length >= 1, '保留最近观察');
});

test('authored assessment retains linked speech under budget pressure instead of reverting to an empty conversation', () => {
  const speech = {
    sourceId: 'message:real-player',
    kind: 'speech',
    knownByActorIds: ['actor'],
    text: 'I want to discuss the arrangement',
  };
  const fitted = fitWithinBudget({
    evaluationCause: { kind: 'authored_eligibility' },
    observations: [
      speech,
      ...Array.from({ length: 40 }, (_, i) => ({
        sourceId: `fact:${i}`,
        kind: 'fact',
        text: 'x'.repeat(2000),
      })),
    ],
    episodes: big(20, 2000),
    candidates: [],
    changes: [],
    worldSetting: 'context',
  });
  assert.ok((fitted.observations as (typeof speech)[]).some((o) => o.sourceId === speech.sourceId));
  assert.ok(JSON.stringify(fitted).length <= CONTEXT_BUDGET);
});

test('budget pressure shares identical provenance and manuscript without losing text', () => {
  const source = { id: 'source', proof: 'p'.repeat(1800) };
  const manuscript = 'm'.repeat(1000);
  const fitted = fitWithinBudget({
    authoredMaterials: {
      source,
      materials: Array.from({ length: 20 }, (_, i) => ({
        ref: { source, nodeKey: `n${i}`, nodeHash: `h${i}` },
        node: { script: manuscript, editorialIntent: manuscript },
      })),
    },
  });
  const catalog = fitted.authoredMaterials as {
    source: typeof source;
    materials: {
      ref: { nodeKey: string; sharedSource: string };
      node: { editorialIntent: string; script?: string; scriptSameAsEditorialIntent?: boolean };
    }[];
  };
  assert.deepEqual(catalog.source, source);
  assert.equal(catalog.materials.length, 20);
  assert.equal(catalog.materials[0]!.ref.sharedSource, 'authoredMaterials.source');
  assert.equal(catalog.materials[0]!.node.editorialIntent, manuscript);
  assert.equal(catalog.materials[0]!.node.script, undefined);
  assert.equal(catalog.materials[0]!.node.scriptSameAsEditorialIntent, true);
});
