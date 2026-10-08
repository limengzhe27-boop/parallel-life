import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PersonSchema, ProfileSchema, ProfileEditSchema } from '../src/contracts/api.ts';
import { personDisplayName, personSummary } from '../src/modules/profile/domain/person-record.ts';
const old = { id: randomUUID(), name: '表姐', relationship: '亲戚', assetId: null };
test('old people and profiles stay readable without a invented name classification', () => {
  assert.deepEqual(PersonSchema.parse(old), old);
  const profile = {
    id: randomUUID(),
    version: 0,
    facts: [],
    events: [],
    people: [old],
    portraitAssetId: null,
    updatedAt: new Date().toISOString(),
  };
  assert.deepEqual(ProfileSchema.parse(profile).people, [old]);
});
test('a temporary label is enough and real names and relationships remain distinct', () => {
  const person = {
    ...old,
    name: '表姐',
    knownName: null,
    temporaryLabel: '表姐',
    relationship: '尚未说明',
    interaction: '对我好但会干涉职业',
    experiences: [{ id: randomUUID(), text: '毕业时陪我去面试', date: null }],
  };
  assert.equal(PersonSchema.safeParse(person).success, true);
  assert.equal(personSummary(person), person.interaction);
  assert.equal(personDisplayName('', person.temporaryLabel), '表姐');
  assert.equal(PersonSchema.safeParse({ ...person, name: '张小红' }).success, false);
  assert.equal(
    ProfileEditSchema.safeParse({
      expectedVersion: 0,
      operation: { kind: 'set-person', person: { ...person, branchRole: '我的下属' } },
    }).success,
    false,
  );
  assert.equal(
    ProfileEditSchema.safeParse({
      expectedVersion: 0,
      operation: { kind: 'set-person', person: { ...person, sourceMessageIds: [randomUUID()] } },
    }).success,
    false,
  );
});

test('person proposals require real explicit relations and literal descriptions, not name/photo guesses', async () => {
  const { groundPersonProposal } =
    await import('../src/modules/profile/application/person-extraction.ts');
  const { PersonProposalSchema } =
    await import('../src/modules/profile/infrastructure/interview-planner.ts');
  const proposal = {
    subject: '表姐',
    messageId: randomUUID(),
    quote: '我表姐对我好，但干涉我的职业选择。',
    description: '对我好，但干涉我的职业选择。',
  };
  assert.equal(groundPersonProposal(proposal, proposal.quote, [])?.subject, '表姐');
  assert.equal(
    groundPersonProposal({ ...proposal, description: '控制型人格' }, proposal.quote, [])
      ?.description,
    proposal.quote,
  );
  assert.equal(
    groundPersonProposal(proposal, '如果我表姐在故事里支持我。' + proposal.quote, []),
    null,
  );
  assert.equal(groundPersonProposal(proposal, '她对我好，但干涉我的职业选择。', []), null);
  assert.equal(
    groundPersonProposal(
      { ...proposal, quote: '我表姐和我同事都很会画画。', description: '很会画画' },
      '我表姐和我同事都很会画画。',
      [],
    ),
    null,
  );
  const existing = { ...old, relationship: '表姐', knownName: null, temporaryLabel: '表姐' };
  assert.equal(groundPersonProposal(proposal, proposal.quote, [existing])?.existingId, existing.id);
  assert.equal(
    groundPersonProposal(proposal, proposal.quote, [existing, { ...existing, id: randomUUID() }]),
    null,
  );
  assert.equal(
    groundPersonProposal({ ...proposal, personId: randomUUID() }, proposal.quote, [existing]),
    null,
  );
  assert.equal(groundPersonProposal({ ...proposal, knownName: '王红' }, proposal.quote, []), null);
  assert.equal(
    PersonProposalSchema.safeParse({ ...proposal, assetId: randomUUID() }).success,
    false,
  );
  const photo = {
    subject: '表姐',
    messageId: randomUUID(),
    quote: '这是我表姐的头像。',
    associatePhoto: true,
  };
  assert.equal(groundPersonProposal(photo, photo.quote, [])?.associatePhoto, true);
  assert.equal(
    groundPersonProposal({ ...photo, quote: '我表姐喜欢摄影。' }, '我表姐喜欢摄影。', [])
      ?.associatePhoto,
    false,
  );
});
