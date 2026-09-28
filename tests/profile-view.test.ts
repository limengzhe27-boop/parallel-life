import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectProfileView,
  collectBasicInfo,
  usableProfileFact,
  readBasicInfo,
  writeBasicInfo,
  type ProfileViewInput,
} from '../src/modules/profile/domain/profile-view.ts';
import { ProfileViewSchema } from '../src/contracts/profile-view.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function sample(): Omit<ProfileViewInput, 'facts' | 'events'> & {
  facts: ProfileViewInput['facts'][number][];
  events: ProfileViewInput['events'][number][];
} {
  const categories = [
    'identity',
    'interest',
    'personality',
    'relationship',
    'experience',
    'wish',
  ] as const;
  return {
    id: id(1),
    version: 7,
    facts: categories.map((category, i) => ({
      id: id(i + 2),
      category,
      value: `${category}原文生日`,
      status: 'confirmed',
      sourceMessageIds: [id(20)],
      updatedAt: '2026-09-28T00:00:00Z',
    })),
    events: [{ id: id(30), title: '一次选择', date: '2020', sourceMessageIds: [] }],
    people: [{ id: id(31), name: '小李', relationship: '朋友', assetId: null }],
  };
}
test('all legacy categories remain visible without keyword hiding, inference or mutation', () => {
  const input = sample();
  const before = structuredClone(input);
  const view = ProfileViewSchema.parse(projectProfileView(input));
  assert.equal(view.current.length, 0);
  assert.equal(view.unresolved[0]?.ref.id, id(2));
  assert.equal(view.interestsAndWishes.length, 3);
  assert.deepEqual(
    view.people.map((item) => item.ref.kind),
    ['fact', 'person'],
  );
  assert.deepEqual(
    view.experiences.map((item) => item.ref.kind),
    ['fact', 'event'],
  );
  assert.equal(view.experiences[1]?.time?.precision, 'year');
  assert.equal(view.people[1]?.evidence, 'unspecified');
  view.unresolved[0]!.sourceMessageIds.push(id(90));
  assert.deepEqual(input, before);
});
test('basic fields keep stable references and preserve unknown and duplicate lines on edit', () => {
  const input = sample();
  const original =
    '个人资料\n姓名：小王\n生日：1998\n职业：设计师\n旧标签：原文\n生日：1999\n未识别原句';
  input.facts[0]!.value = original;
  const view = projectProfileView(input);
  assert.equal(
    view.current.find((item) => item.ref.basicField === '生日'),
    undefined,
  );
  assert.equal(collectBasicInfo(input).birthdayConflict, true);
  assert.equal(view.unresolved[0]?.text, '旧标签：原文\n生日：1999\n未识别原句');
  const parsed = readBasicInfo(original);
  const saved = writeBasicInfo(original, { ...parsed.values, 职业: '教师' });
  assert.ok(saved.includes('旧标签：原文\n生日：1999\n未识别原句'));
  assert.ok(saved.includes('生日：1998'));
  const corrected = writeBasicInfo(original, { ...parsed.values, 生日: '1999' }, true);
  assert.equal(corrected.match(/生日：/g)?.length, 1);
  const reordered = structuredClone(input);
  reordered.facts.reverse();
  assert.deepEqual(projectProfileView(reordered).current, view.current);
});
test('conflicting legacy birthdays are held out of current profile and branch context until corrected', () => {
  const input = sample();
  input.facts[0]!.value = '个人资料\n生日：2000-01-01';
  input.facts.push(
    { ...input.facts[0]!, id: id(40), value: '出生年月日：2005年4月12日' },
    { ...input.facts[0]!, id: id(41), value: '出生于2005年4月12日' },
  );
  const basic = collectBasicInfo(input);
  assert.deepEqual(basic.birthdateClaims, ['2000-01-01', '2005-04-12']);
  assert.equal(basic.birthdayConflict, true);
  assert.equal(projectProfileView(input).current.length, 0);
  assert.equal(usableProfileFact(input, input.facts[0]!), null);
  assert.equal(usableProfileFact(input, input.facts.at(-1)!), null);
  input.facts[0]!.value = '个人资料\n生日：2005-04-12';
  input.facts.slice(-2).forEach((fact) => {
    fact.status = 'rejected';
  });
  assert.equal(projectProfileView(input).current[0]?.text, '2005-04-12');
  assert.equal(usableProfileFact(input, input.facts[0]!)?.value, '个人资料\n生日：2005-04-12');
});
test('rejected facts do not reappear; missing sources and unknown time stay unknown', () => {
  const input = sample();
  input.facts[0]!.status = 'rejected';
  input.facts[1]!.status = 'suggested';
  input.facts[1]!.sourceMessageIds = [];
  input.events[0]!.date = null;
  const view = projectProfileView(input);
  assert.equal(view.current.length, 0);
  assert.equal(view.interestsAndWishes[0]?.storedStatus, 'suggested');
  assert.equal(view.interestsAndWishes[0]?.evidence, 'unspecified');
  assert.deepEqual(view.experiences[1]?.time, { value: null, precision: 'unknown' });
});
test('duplicate basic blocks remain separate original records and empty blocks remain accessible', () => {
  const input = sample();
  input.facts[0]!.value = '个人资料\n';
  input.facts.push({ ...input.facts[0]!, id: id(40), value: '个人资料\n生日：2000-05' });
  const view = projectProfileView(input);
  assert.equal(view.unresolved[0]?.ref.id, id(2));
  assert.equal(view.current[0]?.ref.id, id(40));
  assert.equal(view.current[0]?.time?.precision, 'month');
  assert.equal(ProfileViewSchema.safeParse(view).success, true);
});
