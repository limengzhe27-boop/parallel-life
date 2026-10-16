import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { ensurePublishableDefaults } from '../src/modules/settings/domain/publication-defaults.ts';
import { PublisherTrialPreparation } from '../src/features/publisher/publisher-trial-preparation.ts';
import { publicationDraft } from '../src/features/publisher/publisher-publication-draft.ts';
import { publicationPlayerPreview } from '../src/modules/settings/domain/publication-content.ts';
function content(): any {
  const source = readFileSync(
    new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  return PublishedWorldContentSchema.parse(
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!),
  );
}
test('an unrelated missing field never widens a private relationship to the player or other actors', () => {
  const c = content();
  const a = c.actors[0].key;
  c.relationships.push({
    key: 'private_relation',
    from: { kind: 'player' },
    to: { kind: 'actor', actorKey: a },
    description: 'PRIVATE_SENTINEL',
    visibility: { kind: 'actors', actorKeys: [a] },
  });
  assert.doesNotMatch(
    JSON.stringify(publicationPlayerPreview(PublishedWorldContentSchema.parse(c))),
    /PRIVATE_SENTINEL/,
  );
  delete c.work.experienceNote;
  const before = JSON.stringify(c);
  const prepared = ensurePublishableDefaults(c) as any;
  assert.deepEqual(prepared.relationships, c.relationships);
  assert.doesNotMatch(
    JSON.stringify(publicationPlayerPreview(PublishedWorldContentSchema.parse(prepared))),
    /PRIVATE_SENTINEL/,
  );
  assert.equal(JSON.stringify(c), before);
});
test('over-limit prose remains complete and invalid instead of getting truncated into valid content', () => {
  const c = content();
  delete c.work.experienceNote;
  c.actors[0].privatePersona.background = '字'.repeat(1200) + 'KEEP_TAIL';
  const prepared = ensurePublishableDefaults(c) as any;
  assert.equal(prepared.actors[0].privatePersona.background, c.actors[0].privatePersona.background);
  assert.equal(PublishedWorldContentSchema.safeParse(prepared).success, false);
});
test('unknown sender, hidden actor and explicit timestamps cannot be replaced with invented known history', () => {
  const c = content();
  delete c.work.experienceNote;
  c.actors[0].knownAtStart = false;
  c.phone.messages = [
    {
      key: 'bad_sender',
      actorKey: 'missing',
      speaker: 'actor',
      origin: 'history',
      text: '原文',
      at: 'bad-date',
    },
  ];
  const prepared = ensurePublishableDefaults(c) as any;
  assert.deepEqual(prepared.phone.messages, c.phone.messages);
  assert.equal(prepared.actors[0].knownAtStart, false);
  assert.equal(PublishedWorldContentSchema.safeParse(prepared).success, false);
});
test('explicit duplicate keys and invalid identifiers are not discarded or sanitized into another identity', () => {
  const c = content();
  delete c.work.experienceNote;
  c.actors[1].key = c.actors[0].key;
  c.places[0].key = 'Invalid-place';
  const prepared = ensurePublishableDefaults(c) as any;
  assert.equal(prepared.actors.length, c.actors.length);
  assert.equal(prepared.actors[1].key, c.actors[1].key);
  assert.equal(prepared.places[0].key, c.places[0].key);
  assert.equal(PublishedWorldContentSchema.safeParse(prepared).success, false);
});
test('notes, invitations, source history and existing fine-grained event settings are not removed by default completion', () => {
  const c = content();
  delete c.work.experienceNote;
  const prepared = ensurePublishableDefaults(c) as any;
  for (const key of [
    'phone',
    'history',
    'initialKnowledge',
    'candidates',
    'relationships',
    'routes',
    'media',
    'extensions',
  ])
    assert.deepEqual(prepared[key], c[key], key);
});
test('new scene images, aliases, Moments visibility and multiple image references survive unrelated completion', () => {
  const c = content();
  delete c.work.experienceNote;
  c.places[0].sceneImage = { assetId: '11111111-1111-4111-8111-111111111111' };
  c.places[0].aliases = ['别名'];
  c.actors[0].publicCard.momentsVisibility = 'three_days';
  c.phone.moments = [
    {
      key: 'post',
      actorKey: c.actors[0].key,
      text: '原文',
      at: '2024-05-11T00:00:00Z',
      images: ['/image-one', '/image-two'],
      visibility: { kind: 'after_statement', actorKey: c.actors[0].key, statement: '原句' },
    },
  ];
  const p = ensurePublishableDefaults(c) as any;
  assert.deepEqual(p.places[0].sceneImage, c.places[0].sceneImage);
  assert.deepEqual(p.places[0].aliases, c.places[0].aliases);
  assert.deepEqual(
    p.actors[0].publicCard.momentsVisibility,
    c.actors[0].publicCard.momentsVisibility,
  );
  assert.deepEqual(p.phone.moments, c.phone.moments);
});
test('whitespace and paragraphs in authored text stay byte-for-byte while genuinely missing metadata can be filled', () => {
  const c = content();
  delete c.work.experienceNote;
  c.world.publicSetting = '  第一段\n\n第二段  ';
  const p = ensurePublishableDefaults(c) as any;
  assert.equal(p.world.publicSetting, c.world.publicSetting);
  assert.equal(typeof p.work.experienceNote, 'string');
  assert.ok(p.work.experienceNote);
  assert.ok(c.work.experienceNote === undefined);
});

test('missing scaffolding never invents a person, personality, date, location, route, or social history', () => {
  const c = {
    actors: [{ key: 'person', name: '原名', publicCard: {} }],
    places: [{ key: 'place', name: '原地点' }],
    world: {},
    work: {},
  };
  const p = ensurePublishableDefaults(c) as any;
  assert.deepEqual(p.world, {});
  assert.deepEqual(p.actors, [{ key: 'person', name: '原名', publicCard: { traits: [] } }]);
  assert.deepEqual(p.places, [{ key: 'place', name: '原地点', description: '' }]);
  assert.deepEqual(p.routes, []);
  assert.deepEqual(p.phone, { messages: [], notes: [], invitations: [], album: [] });
  assert.equal(PublishedWorldContentSchema.safeParse(p).success, false);
  assert.deepEqual(ensurePublishableDefaults(p), p);
});

test('invalid authored sender and over-limit prose never trigger paid preparation or save guessed replacements', async () => {
  for (const kind of ['sender', 'prose']) {
    const c = content();
    if (kind === 'sender')
      c.phone.messages = [
        {
          key: 'bad',
          actorKey: 'unknown_actor',
          origin: 'history',
          text: '原文',
          at: c.world.startAt,
        },
      ];
    else c.actors[0].privatePersona.background = '字'.repeat(1201);
    const work: any = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: c.work.title,
      draftVersion: 0,
      draft: { version: 0, contentHash: 'a'.repeat(64), content: c },
    };
    const calls: string[] = [];
    const client: any = {
      async check() {
        calls.push('check');
        return {
          workId: work.id,
          draftVersion: 0,
          contentHash: work.draft.contentHash,
          issues: [{ code: 'custom', path: ['actors'] }],
          missingCapabilities: [],
          status: 'invalid',
        };
      },
      async save() {
        throw Error('Unexpected save');
      },
      async prepareTrial() {
        throw Error('Unexpected model');
      },
    };
    const before = JSON.stringify(c);
    await assert.rejects(
      new PublisherTrialPreparation(client, () => 'id').open(
        work,
        { title: work.title, content: c },
        {
          onWork() {
            throw Error('Unexpected edit');
          },
          onProgress() {},
        },
      ),
      (error: any) => error.code === 'TRIAL_AUTHOR_INPUT_INVALID',
    );
    assert.deepEqual(calls, ['check']);
    assert.equal(JSON.stringify(c), before);
    assert.deepEqual(publicationDraft({ title: work.title, content: c }).content, c);
  }
});

test('empty workbench experience-note sentinel uses deterministic technical preparation without changing authored prose', () => {
  for (const note of ['', '  \n  ']) {
    const c = content();
    c.work.experienceNote = note;
    c.world.publicSetting = '  第一段\n\n末段  ';
    const before = JSON.stringify(c);
    const draft = publicationDraft({ title: c.work.title, content: c });
    assert.equal((draft.content.work as any).experienceNote, '沉浸式平行人生体验');
    assert.equal((draft.content.world as any).publicSetting, c.world.publicSetting);
    assert.deepEqual(draft.content.actors, c.actors);
    assert.ok(PublishedWorldContentSchema.safeParse(draft.content).success);
    assert.equal(JSON.stringify(c), before);
  }
  const c = content();
  c.work.experienceNote = '  作者自写体验说明\n\n原样保留  ';
  assert.equal(
    (publicationDraft({ title: c.work.title, content: c }).content.work as any).experienceNote,
    c.work.experienceNote,
  );
});
