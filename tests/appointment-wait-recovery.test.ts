import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
registerHooks({
  load(url, context, nextLoad) {
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
const { AppointmentWaitRecovery } =
  await import('../src/features/phone/appointment-wait-recovery.tsx');
test('unknown wait recovery remains available independently of fresh calendar eligibility', () => {
  const html = renderToStaticMarkup(
    createElement(AppointmentWaitRecovery, {
      pending: true,
      working: false,
      message: '',
      onRecover: () => {},
    }),
  );
  assert.ok(html.includes('核对原等待'));
  assert.ok(!html.includes('disabled'));
  const busy = renderToStaticMarkup(
    createElement(AppointmentWaitRecovery, {
      pending: true,
      working: true,
      message: '',
      onRecover: () => {},
    }),
  );
  assert.ok(busy.includes('disabled'));
  assert.ok(busy.includes('正在核对'));
  const resolved = renderToStaticMarkup(
    createElement(AppointmentWaitRecovery, {
      pending: false,
      working: false,
      message: '已核对原等待',
      onRecover: () => {},
    }),
  );
  assert.ok(resolved.includes('已核对原等待'));
  assert.ok(!resolved.includes('<button'));
});
