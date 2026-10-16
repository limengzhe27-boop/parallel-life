import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePublicationGenesis } from '../src/modules/settings/infrastructure/publication-genesis.ts';
import type { PublicationCompileInput } from '../src/modules/settings/application/publication-runtime.ts';
import type { PublicationWorldPrepare } from '../src/modules/settings/application/publication-world-ports.ts';
import {
  publicationCharacterTrialCompiler,
  publicationWorldCompiler,
  publicationReview,
} from '../src/server/publication-runtime.ts';
import { PublicationWorldRepository } from '../src/modules/settings/infrastructure/publication-world-repository.ts';
import type { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function content() {
  return {
    schemaVersion: 1 as const,
    work: {
      key: 'demo',
      title: '未知角色私有演示',
      hook: '当下对话',
      description: '私有日常演示',
      experienceNote: '未发布',
    },
    world: {
      publicSetting: '普通工作间',
      tone: '日常',
      startAt: '2031-03-06T08:00:00Z',
      startPlaceKey: 'room',
      hiddenContext: '没有预定结果',
    },
    protagonist: { identity: '来访者', situation: '当下可以发起对话', knownFactKeys: [] },
    actors: [
      {
        key: 'solo',
        name: '林夏',
        knownAtStart: false,
        publicCard: { traits: [], introduction: '作者提供的角色介绍' },
        privatePersona: {
          background: '背景尚未提供',
          motivation: '尚未说明具体动机',
          voice: '简短自然',
          boundaries: '不替主角做决定',
        },
      },
    ],
    places: [{ key: 'room', name: '工作间', description: '普通空间', knownAtStart: true }],
    routes: [],
    relationships: [],
    history: [],
    initialKnowledge: [],
    phone: { messages: [], moments: [], notes: [], invitations: [], album: [] },
    media: [],
    candidates: [],
    extensions: [],
  };
}
function input(kind: 'trial' | 'published' = 'trial'): PublicationCompileInput {
  let seq = 10;
  return {
    content: content(),
    originKind: kind,
    origin: {
      workId: id(4),
      publicationVersion: kind === 'trial' ? 0 : 1,
      draftVersion: 0,
      contentHash: 'a'.repeat(64),
    },
    worldId: id(1),
    ownerId: id(2),
    seedId: id(3),
    newId: () => id(seq++),
  };
}
function prepared(): PublicationWorldPrepare {
  const i = input();
  return {
    content: i.content,
    origin: i.origin,
    originKind: 'trial',
    worldId: i.worldId,
    ownerId: i.ownerId,
    seedId: i.seedId,
  };
}
test('only explicit private trial compilation projects an unknown contact without changing authored false or creating any history', () => {
  const ordinary = input(),
    snapshot = structuredClone(ordinary.content);
  const denied = compilePublicationGenesis(ordinary);
  assert.equal(denied.status, 'unsupported');
  if (denied.status === 'unsupported')
    assert.ok(denied.issues.some((i) => i.code === 'unsupported_unknown_actor_projection'));
  const allowed = compilePublicationGenesis({ ...ordinary, privateCharacterDemo: true });
  assert.equal(allowed.status, 'compiled');
  if (allowed.status !== 'compiled') throw Error('expected demo compile');
  assert.equal(allowed.opening.contacts.length, 1);
  assert.equal(allowed.opening.contacts[0]!.relationship, '');
  assert.deepEqual(allowed.world.messages, []);
  assert.deepEqual(allowed.world.facts, []);
  assert.deepEqual(ordinary.content, snapshot);
  assert.equal((ordinary.content as ReturnType<typeof content>).actors[0]!.knownAtStart, false);
  assert.equal(compilePublicationGenesis(input('published')).status, 'unsupported');
  assert.equal(
    compilePublicationGenesis({ ...input('published'), privateCharacterDemo: true }).status,
    'invalid',
  );
  assert.equal(
    compilePublicationGenesis({ ...input(), content: { ...content(), privateCharacterDemo: true } })
      .status,
    'invalid',
  );
});
test('the explicit private server adapter succeeds but ordinary adapter and public review keep their original unknown-person rejection', async () => {
  const p = prepared();
  assert.throws(() => publicationWorldCompiler.prepare(p), { code: 'INVALID_STATE' });
  const actual = (await publicationCharacterTrialCompiler.prepare(p)) as {
    opening: { contacts: unknown[] };
    world: { messages: unknown[] };
  };
  assert.equal(actual.opening.contacts.length, 1);
  assert.deepEqual(actual.world.messages, []);
  assert.throws(
    () =>
      publicationCharacterTrialCompiler.prepare({
        ...p,
        originKind: 'published_work',
        origin: { ...p.origin, publicationVersion: 1 },
      }),
    { code: 'INVALID_STATE' },
  );
  const review = await publicationReview(async () => ({ verified: true, receiptId: id(9) })).review(
    { content: content(), workId: id(4), draftVersion: 0, contentHash: 'a'.repeat(64) },
  );
  assert.equal(review.runtimeCapabilities.size, 0);
});
test('repository validation permits unknown contacts only with the trusted private option and never admits a player publication through that repository', async () => {
  const p = prepared();
  let commits = 0;
  const db = {
    async transaction(_owner: string, run: (sql: unknown) => Promise<unknown>) {
      return run({
        async query(statement: string) {
          if (statement.includes('set_config')) return { rows: [] };
          if (statement.includes('publication_admit_trial'))
            return { rows: [{ admission: { ...p, ticket: id(8) } }] };
          if (statement.includes('octet_length'))
            return { rows: [{ world_bytes: 100, opening_bytes: 100, seed_bytes: 100 }] };
          if (statement.includes('publication_commit_trial')) {
            commits++;
            return {
              rows: [
                {
                  result: {
                    worldId: p.worldId,
                    seedId: p.seedId,
                    origin: p.origin,
                    originKind: 'trial',
                    trialId: id(9),
                    resumed: false,
                    replayed: false,
                  },
                },
              ],
            };
          }
          throw Error('unexpected ' + statement);
        },
      });
    },
  } as unknown as PostgresDatabase;
  const command = { commandId: id(7), draftVersion: 0, contentHash: 'a'.repeat(64) };
  await assert.rejects(
    new PublicationWorldRepository(db, publicationCharacterTrialCompiler).startTrial(
      id(6),
      id(4),
      command,
    ),
    { code: 'INVALID_STATE' },
  );
  assert.equal(commits, 0);
  const privateRepo = new PublicationWorldRepository(db, publicationCharacterTrialCompiler, {
    characterTrial: true,
  });
  const result = await privateRepo.startTrial(id(6), id(4), command);
  assert.equal(result.originKind, 'trial');
  assert.equal(commits, 1);
  assert.throws(
    () => privateRepo.startPublished(id(2), id(4), { commandId: id(7), publicationVersion: 1 }),
    { code: 'INVALID_STATE' },
  );
  assert.equal(commits, 1);
});
