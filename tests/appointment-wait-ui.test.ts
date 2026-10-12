import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('.tsx') && !url.includes('/node_modules/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { CalendarWaitAction, calendarWaitTransition } =
  await import('../src/features/phone/apps/calendar.tsx');
const base = {
  invitation: { status: 'confirmed' as const, at: '2026-10-17T10:00:00.000Z' },
  referenceTime: '2026-10-16T09:00:00.000Z',
  eligible: true,
  busy: false,
  onWait: () => {},
};
test('real wait action is visible only with explicit host qualification and confirmed future invitation', () => {
  const html = renderToStaticMarkup(createElement(CalendarWaitAction, base));
  assert.ok(html.includes('等到约定时间'));
  assert.ok(!html.includes('赴约成功'));
  assert.equal(CalendarWaitAction({ ...base, eligible: false }), null);
});
test('proposed/cancelled/attended/missed or legacy unknown status never show a wait button', () => {
  for (const status of ['proposed', 'cancelled', 'attended', 'missed'] as const)
    assert.equal(CalendarWaitAction({ ...base, invitation: { ...base.invitation, status } }), null);
});
test('a legacy JSON record missing status cannot show a confirmed wait action', () => {
  const invitation = JSON.parse(JSON.stringify({ at: base.invitation.at }));
  assert.equal(CalendarWaitAction({ ...base, invitation }), null);
});
test('a due or past invitation enters through the existing scene flow, never by another wait', () => {
  for (const at of [base.referenceTime, '2026-10-16T08:00:00.000Z'])
    assert.equal(CalendarWaitAction({ ...base, invitation: { ...base.invitation, at } }), null);
});
test('malformed times do not fabricate wait qualification', () => {
  assert.equal(CalendarWaitAction({ ...base, referenceTime: '' }), null);
  assert.equal(
    CalendarWaitAction({ ...base, invitation: { ...base.invitation, at: 'unknown' } }),
    null,
  );
});
test('native button calls the actual onWait callback once without a model or scene callback', () => {
  let calls = 0;
  const button = CalendarWaitAction({ ...base, onWait: () => calls++ });
  assert.ok(isValidElement(button));
  (button as ReactElement<{ onClick: () => void }>).props.onClick();
  assert.equal(calls, 1);
});
test('busy action blocks manually invoked native handler, not just disabled markup', () => {
  let calls = 0;
  const button = CalendarWaitAction({
    ...base,
    busy: true,
    onWait: () => calls++,
  }) as ReactElement<{ onClick: () => void; disabled: boolean }>;
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(calls, 0);
});
test('cross-day transition explicitly names a date change and keeps attendance unconfirmed', () => {
  const text = calendarWaitTransition(base.referenceTime, base.invitation.at);
  assert.ok(text.includes('日期从'));
  assert.ok(text.includes('还没有替你进入现场或记录赴约'));
  assert.ok(!text.includes('已赴约'));
});
test('same-day transition reports time only and never invents an intervening routine or NPC presence', () => {
  const text = calendarWaitTransition(base.referenceTime, '2026-10-16T10:00:00.000Z');
  assert.ok(!text.includes('日期从'));
  assert.ok(text.includes('时间到了'));
  assert.ok(!text.includes('对方已经'));
});
