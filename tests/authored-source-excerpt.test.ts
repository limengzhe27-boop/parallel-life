import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredSourceExcerpt } from '../src/modules/world/domain/authored-source-excerpt.ts';
import {
  selectActorPersona,
  reserveActorContext,
} from '../src/modules/world/domain/actor-situation.ts';
import { selectCharacterSource } from '../src/modules/settings/infrastructure/publication-event-goal-context.ts';

test('short source keeps exact paragraphs and punctuation', () => {
  const source = '  身份：大学同学。\n\n她习惯先询问，再行动。  ';
  assert.equal(authoredSourceExcerpt(source, '行动', 1200), source);
});

test('excerpts retain opening identity and relevant intact sentences in source order', () => {
  const source = '身份是大学同学。\n' + '她喜欢散步。\n'.repeat(400) + '医院照护由她协调。';
  const selected = authoredSourceExcerpt(source, '医院照护', 100);
  assert(selected.startsWith('身份是大学同学。'));
  assert(selected.endsWith('医院照护由她协调。'));
  assert(selected.length <= 100);
  for (const unit of selected.split('\n')) assert(source.includes(unit));
});

test('legal and oversized unpunctuated Chinese paragraphs never escape the budget', () => {
  for (const length of [4001, 16384, 24000]) {
    const source = '字'.repeat(length);
    for (const limit of [1000, 1200, 1400, 1600, 2000]) {
      const selected = authoredSourceExcerpt(source, '人物', limit);
      assert(selected.length > 0);
      assert(selected.length <= limit);
      for (const part of selected.split('\n')) assert(source.includes(part));
    }
    assert.equal(source.length, length);
    assert(selectCharacterSource(source, '人物', 1200).length <= 1200);
    assert(selectCharacterSource(source, '人物', 1000).length <= 1000);
  }
});

test('emoji windows preserve grapheme clusters and never split surrogate pairs', () => {
  const emoji = '👩🏽‍⚕️';
  const source = emoji.repeat(2400);
  for (const limit of [1000, 1200, 1400, 1600, 2000]) {
    const selected = authoredSourceExcerpt(source, '照护', limit);
    assert(selected.length > 0 && selected.length <= limit);
    for (const part of selected.split('\n')) {
      assert(source.includes(part));
      assert.equal(part.replaceAll(emoji, ''), '');
      assert(!/[\uD800-\uDFFF]/u.test(part));
    }
  }
});

test('a topical raw window can be selected from an indivisible paragraph', () => {
  const source = '字'.repeat(10000) + '医院照护' + '字'.repeat(6000);
  const selected = authoredSourceExcerpt(source, '医院照护', 1200);
  assert(selected.startsWith('字'));
  assert(selected.includes('医院照护'));
  assert(selected.length <= 1200);
});

test('five legal max-length modules plus bounded goal fit the actor context', () => {
  const source = '字'.repeat(16384);
  const modules = {
    lifeContext: source,
    traits: source,
    drives: source,
    behavior: source,
    relationships: source,
  };
  const snapshot = structuredClone(modules);
  const selected = selectActorPersona(modules, '人物')!;
  const limits = {
    lifeContext: 1400,
    traits: 1600,
    drives: 1400,
    behavior: 2000,
    relationships: 1400,
  };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    assert(selected[key]!.length > 0 && selected[key]!.length <= limits[key]);
  }
  const input = {
    messages: [],
    facts: [],
    authoredLifeModules: selected,
    eventGoals: [
      {
        want: selectCharacterSource(source, '人物', 1200),
        stance: selectCharacterSource(source, '人物', 1000),
      },
    ],
  };
  const context = reserveActorContext(input, '你好');
  assert(JSON.stringify(context).length <= 18000);
  assert.deepEqual(context, input);
  assert.deepEqual(modules, snapshot);
});

test('newlines count toward the limit and source selection stays deterministic', () => {
  const source = '第一句。\n' + '第二句。\n'.repeat(100);
  for (const limit of [1, 5, 10, 19, 1200]) {
    const selected = authoredSourceExcerpt(source, '第二', limit, 4);
    assert(selected.length <= limit);
    assert.equal(selected, authoredSourceExcerpt(source, '第二', limit, 4));
  }
});

test('pressure compaction preserves two full 4000-character messages, sources and refusal boundaries', () => {
  const source = '字'.repeat(16384);
  const input = {
    actor: { id: 'actor-a', name: '林白语', persona: source },
    actorSituation: {
      worldVersion: 7,
      storyAt: '2026-10-15T08:00:00Z',
      eventOutcome: null,
      opening: {
        nodeKey: 'opening',
        direction: source,
        sourceMessageId: 'opening-message',
        sourceEventId: 'opening-event',
        deliveredAt: '2026-10-15T08:00:00Z',
        sourceVersion: 1,
      },
    },
    authoredLifeModules: selectActorPersona(
      {
        lifeContext: source,
        traits: source,
        drives: source,
        behavior: source,
        relationships: source,
      },
      '医院',
    ),
    messages: [
      { id: 'm1', role: 'user', text: '前'.repeat(4000) },
      { id: 'm2', role: 'assistant', text: '后'.repeat(4000) },
    ],
    facts: [],
    eventGoals: Array.from({ length: 4 }, (_, index) => ({
      goalKey: `goal-${index}`,
      actorId: 'actor-a',
      source: { sourceMessageId: `source-${index}`, sourceEventId: `event-${index}` },
      want: selectCharacterSource(source, '医院', 1200),
      stance: selectCharacterSource(source, '医院', 1000),
      boundaries: ['不把拒绝当成同意。'],
      participation: 'declined',
      status: 'deferred',
    })),
  };
  const original = structuredClone(input);
  const userText = '今'.repeat(4000);
  // prepareContext runs before the current user input is attached; it must also fit.
  const prepared = reserveActorContext(input, '');
  const selected = reserveActorContext(input, userText);
  for (const context of [prepared, selected]) {
    assert(JSON.stringify(context).length <= 18000);
    assert(JSON.stringify({ context, userText }).length <= 24000);
    assert.deepEqual(context.messages, original.messages);
    assert.equal(context.actor.id, original.actor.id);
    assert.equal(context.actor.name, original.actor.name);
    const { direction: _direction, ...sourceBoundary } = context.actorSituation.opening;
    const { direction: _originalDirection, ...originalBoundary } = original.actorSituation.opening;
    assert.deepEqual(sourceBoundary, originalBoundary);
    for (const [index, goal] of context.eventGoals.entries()) {
      const { want: _want, stance: _stance, ...boundary } = goal;
      const {
        want: _originalWant,
        stance: _originalStance,
        ...expected
      } = original.eventGoals[index]!;
      assert.deepEqual(boundary, expected);
    }
  }
  assert.deepEqual(input, original);
  assert.equal(userText.length, 4000);
  const escaped = structuredClone(input);
  escaped.messages = escaped.messages.map((message) => ({ ...message, text: '\n'.repeat(4000) }));
  const escapedContext = reserveActorContext(escaped, userText);
  assert(JSON.stringify(escapedContext).length <= 18000);
  assert.deepEqual(escapedContext.messages, escaped.messages);
  assert(JSON.stringify({ context: escapedContext, userText }).length <= 24000);
});

test('fitting required source text is unchanged; oversized non-text identity fails explicitly', () => {
  const input = { actor: { persona: '完整短设定。' }, messages: [], facts: [] };
  assert.deepEqual(reserveActorContext(input, '你好'), input);
  assert.throws(
    () => reserveActorContext({ ...input, immutableSourceIds: ['x'.repeat(25000)] }, ''),
    /ACTOR_REQUIRED_CONTEXT_EXCEEDS_BUDGET/,
  );
});

test('legacy JSON persona keeps valid structure, identity and boundaries under pressure', () => {
  const original = {
    name: '林白语',
    identity: '大学同学',
    privatePersona: { background: '字'.repeat(16000), boundaries: '不替玩家作决定。' },
  };
  const input = {
    actor: { persona: JSON.stringify(original) },
    messages: [{ text: '前'.repeat(4000) }, { text: '后'.repeat(4000) }],
    facts: [],
  };
  const selected = reserveActorContext(input, '你好');
  const parsed = JSON.parse(selected.actor.persona);
  assert.equal(parsed.name, original.name);
  assert.equal(parsed.identity, original.identity);
  assert.equal(parsed.privatePersona.boundaries, original.privatePersona.boundaries);
  assert(parsed.privatePersona.background.length > 0);
  assert(JSON.stringify(selected).length <= 18000);
  assert.equal(input.actor.persona, JSON.stringify(original));
});
