import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
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
const { PublisherOpeningEditor } =
  await import('../src/features/publisher/publisher-opening-editor.tsx');
type Data = Record<string, unknown>;
type Element = ReactElement<Data>;
function walk(v: ReactNode): Element[] {
  if (Array.isArray(v)) return v.flatMap(walk);
  if (!isValidElement(v)) return [];
  const e = v as Element;
  return [e, ...walk(e.props.children as ReactNode)];
}
const fixture = (at: unknown = '2026-10-12T08:00:00Z') => ({
  world: { startAt: '2026-10-12T09:00:00Z' },
  actors: [{ key: 'a', name: '宁遥', knownAtStart: true }],
  phone: {
    messages: [
      {
        key: 'm',
        actorKey: 'a',
        origin: 'history',
        text: '先核账再采购。',
        at,
        future: { preserved: true },
      },
    ],
    notes: [{ key: 'n', text: '保留' }],
    invitations: [],
  },
  extensions: [{ data: 'unknown preserved' }],
});
function setup(at?: unknown, disabled = false) {
  const content = fixture(at);
  let next: Data | undefined;
  let calls = 0;
  const nodes = walk(
    PublisherOpeningEditor({
      content,
      disabled,
      onChange(v) {
        next = v;
        calls++;
      },
    }),
  );
  return {
    content,
    nodes,
    get next() {
      return next;
    },
    get calls() {
      return calls;
    },
  };
}
const change = (e: Element, value: string) =>
  (e.props.onChange as (event: unknown) => void)({ target: { value } });
test('existing opening message dates are collapsed while content remains editable and no render writes occur', () => {
  const t = setup();
  const fold = t.nodes.find((n) => n.type === 'details')!;
  assert.equal(fold.props.open, false);
  const textarea = t.nodes.find((n) => n.type === 'textarea')!;
  change(textarea, '只修改正文');
  const phone = t.next!.phone as ReturnType<typeof fixture>['phone'];
  assert.equal(phone.messages[0]!.at, t.content.phone.messages[0]!.at);
  assert.deepEqual(phone.messages[0]!.future, { preserved: true });
  assert.deepEqual(phone.notes, t.content.phone.notes);
  assert.deepEqual(t.next!.extensions, t.content.extensions);
  assert.equal(t.calls, 1);
});
test('missing or invalid message times expand the date field without inventing a timestamp', () => {
  for (const at of ['', '待定', 123]) {
    const t = setup(at);
    assert.equal(t.nodes.find((n) => n.type === 'details')!.props.open, true);
    assert.equal(t.nodes.find((n) => n.type === 'input')!.props.value, '');
    assert.equal(t.content.phone.messages[0]!.at, at);
    assert.equal(t.calls, 0);
  }
});
test('editing a date keeps the original timezone conversion and unrelated values', () => {
  const t = setup('');
  change(
    t.nodes.find((n) => n.type === 'input')!,
    '2026-10-12T16:30',
  );
  const phone = t.next!.phone as ReturnType<typeof fixture>['phone'];
  assert.equal(phone.messages[0]!.at, '2026-10-12T08:30:00.000Z');
  assert.equal(phone.messages[0]!.origin, 'history');
  assert.deepEqual(t.next!.extensions, t.content.extensions);
});
test('readonly callbacks and invalid native dates cannot mutate the draft', () => {
  const t = setup('', true);
  change(
    t.nodes.find((n) => n.type === 'input')!,
    '2026-10-12T16:30',
  );
  change(
    t.nodes.find((n) => n.type === 'textarea')!,
    '不可写',
  );
  assert.equal(t.calls, 0);
  const editable = setup('');
  change(
    editable.nodes.find((n) => n.type === 'input')!,
    '2026-02-30T16:30',
  );
  assert.equal(editable.calls, 0);
});
