import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import {
  readDirectorActorDirectionMaterials,
  DIRECTOR_ACTOR_DIRECTION_EXCERPT_LIMIT,
} from '../src/modules/world/infrastructure/director-actor-direction-materials.ts';
import { authoredSourceExcerpt } from '../src/modules/world/domain/authored-source-excerpt.ts';
const sql = (
  rows: { actor_id: string; modules: unknown }[],
  inspect?: (text: string, values: unknown[]) => void,
) =>
  ({
    async query(text: string, values: unknown[]) {
      inspect?.(text, values);
      return { rows };
    },
  }) as unknown as SqlClient;
test('stable authenticated actor IDs preserve each independent set of authored dimensions despite reversed rows', async () => {
  const rows = [
    {
      actor_id: 'b',
      modules: {
        lifeContext: 'B background',
        traits: 'B traits',
        drives: 'B own motives',
        behavior: 'B acts',
        relationships: 'B relation to player',
      },
    },
    {
      actor_id: 'a',
      modules: {
        lifeContext: 'A background',
        traits: 'A traits',
        drives: 'A own motives',
        behavior: 'A acts',
        relationships: 'A relation to player',
      },
    },
  ];
  const result = await readDirectorActorDirectionMaterials(
    sql(rows, (text, values) => {
      assert.match(text, /publication_actor_life_modules\(\$1,actor_id\)/);
      assert.deepEqual(values, ['world', ['a', 'b']]);
    }),
    'world',
    ['b', 'a'],
  );
  assert.deepEqual(
    result.map((r) => r.actorId),
    ['a', 'b'],
  );
  assert.equal(result[0]!.modules.drives, 'A own motives');
  assert.equal(result[1]!.modules.relationships, 'B relation to player');
  assert.equal(rows[0]!.actor_id, 'b');
});
test('all five long dimensions are independently bounded with the existing deterministic excerpt strategy', async () => {
  const long =
    'A distinct identity and authored background.\n' + 'Long source sentence.\n'.repeat(600);
  const modules = {
    lifeContext: long,
    traits: long,
    drives: long,
    behavior: long,
    relationships: long,
  };
  const result = await readDirectorActorDirectionMaterials(
    sql([{ actor_id: 'a', modules }]),
    'world',
    ['a'],
  );
  assert.equal(Object.keys(result[0]!.modules).length, 5);
  for (const value of Object.values(result[0]!.modules)) {
    assert.ok(value.length <= DIRECTOR_ACTOR_DIRECTION_EXCERPT_LIMIT);
    assert.equal(value, authoredSourceExcerpt(long, '', 4000));
  }
  assert.equal(modules.lifeContext, long);
});
test('no published modules or empty modules do not invent default personality, requests or facts', async () => {
  assert.deepEqual(
    await readDirectorActorDirectionMaterials(
      sql([
        { actor_id: 'a', modules: null },
        { actor_id: 'b', modules: {} },
      ]),
      'world',
      ['a', 'b'],
    ),
    [],
  );
  assert.deepEqual(await readDirectorActorDirectionMaterials(sql([]), 'world', []), []);
});
for (const [name, rows] of [
  ['foreign actor', [{ actor_id: 'foreign', modules: { traits: 'unknown' } }]],
  ['missing actor', []],
  [
    'duplicate actor',
    [
      { actor_id: 'a', modules: { traits: 'x' } },
      { actor_id: 'a', modules: { traits: 'y' } },
    ],
  ],
  [
    'unknown dimension',
    [{ actor_id: 'a', modules: { traits: 'x', privateInterview: 'must not enter' } }],
  ],
  ['non-string dimension', [{ actor_id: 'a', modules: { drives: 42 } }]],
] as [string, { actor_id: string; modules: unknown }[]][])
  test(`rejects ${name}`, async () => {
    await assert.rejects(readDirectorActorDirectionMaterials(sql(rows), 'world', ['a']), {
      code: 'DIRECTOR_ACTOR_DIRECTION_SCOPE',
    });
  });
test('duplicate requested actors are an invalid scope, never merged by name or array position', async () => {
  await assert.rejects(readDirectorActorDirectionMaterials(sql([]), 'world', ['a', 'a']), {
    code: 'DIRECTOR_ACTOR_DIRECTION_SCOPE',
  });
});
