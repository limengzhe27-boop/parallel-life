import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentFocusAnchor,
  preservesFocus,
} from '../src/modules/discovery/application/branch-focus.ts';
test('an explicit latest wish preserves its literal identity rather than a related profession', () => {
  assert.equal(currentFocusAnchor('我现在想体验舞台摄影师，维修自行车只是爱好。'), '舞台摄影师');
  assert.equal(currentFocusAnchor('我想成为一名摄影师；我其实想成为医生的身份'), '医生');
  assert.equal(currentFocusAnchor('这次想体验摄影师而不是导演'), '摄影师');
});
test('negation, quotation, reported wishes and questions do not invent a current identity', () => {
  for (const text of [
    '我不想成为医生',
    '他说我想成为医生',
    '他说“我想成为医生”',
    '我只是转述：我想成为医生',
    '我想成为医生吗？',
    '最近很累',
    '我想做饭',
  ])
    assert.equal(currentFocusAnchor(text), null, text);
  assert.equal(currentFocusAnchor('我不想成为医生，我想成为摄影师'), '摄影师');
});

test('later refusals cancel an old identity and a positive later correction takes precedence', () => {
  assert.equal(currentFocusAnchor('我想当摄影师；我不想当摄影师'), null);
  assert.equal(currentFocusAnchor('我想当医生但我想当摄影师'), '摄影师');
  assert.equal(currentFocusAnchor('我想体验舞台摄影师的生活\n我现在不想体验舞台摄影师了'), null);
  assert.equal(currentFocusAnchor('我想成为摄影师；算了，我不想成为摄影师了'), null);
});
test('mentioning the anchor as a rejected or abandoned role cannot satisfy focused output', () => {
  for (const premise of [
    '不是舞台摄影师，而是舞台设计师',
    '不做舞台摄影师',
    '告别舞台摄影师，转行舞台设计',
    '作为舞台摄影师之后转行成为设计师',
  ])
    assert.equal(preservesFocus(premise, '舞台摄影师'), false, premise);
  assert.equal(preservesFocus('作为舞台摄影师跟剧组拍演出', '舞台摄影师'), true);
});
