import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({},{get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('publisher-space-editor.tsx'))
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
    return next(url, context);
  },
});
const { PublisherSpaceEditor } =
  await import('../src/features/publisher/publisher-space-editor.tsx');
type Native = ReactElement<Record<string, unknown>>;
function nodes(v: ReactNode): Native[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!isValidElement(v)) return [];
  const e = v as Native;
  return [e, ...nodes(e.props.children as ReactNode)];
}
const data = {
  places: [
    {
      key: 'internal_home',
      name: '小院',
      description: '完整旧描述'.repeat(80),
      knownAtStart: true,
      extra: '保留',
    },
  ],
  routes: [],
  extension: { value: '保留' },
};
test('existing locations start as a collapsed name and single-line description without losing long author text', () => {
  let calls = 0;
  const before = JSON.stringify(data);
  const tree = nodes(
    PublisherSpaceEditor({ content: data, disabled: false, onChange: () => calls++ }),
  );
  const detail = tree.find((n) => n.type === 'details')!;
  assert.equal(detail.props.open, false);
  const description = tree.find((n) => n.type === 'textarea')!;
  assert.equal(description.props.value, data.places[0]!.description);
  (description.props.onChange as (v: unknown) => void)({ target: { value: '新说明' } });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(data), before);
});
test('editing a location preserves unknown fields and read-only handlers cannot mutate it', () => {
  for (const disabled of [false, true]) {
    let updated: Record<string, unknown> | undefined;
    const tree = nodes(
      PublisherSpaceEditor({ content: data, disabled, onChange: (v) => (updated = v) }),
    );
    const name = tree.find((n) => n.type === 'input' && n.props.value === '小院')!;
    (name.props.onChange as (v: unknown) => void)({ target: { value: '新院子' } });
    if (disabled) assert.equal(updated, undefined);
    else assert.deepEqual(updated, { ...data, places: [{ ...data.places[0], name: '新院子' }] });
  }
});
test('new unnamed locations open for naming without requiring a new story synopsis', () => {
  const tree = nodes(
    PublisherSpaceEditor({
      content: { places: [{ key: 'new', name: '', description: '' }] },
      disabled: false,
      onChange: () => {
        throw Error('no automatic write');
      },
    }),
  );
  assert.equal(tree.find((n) => n.type === 'details')!.props.open, true);
  assert.equal(tree.find((n) => n.type === 'textarea')!.props.required, undefined);
});
