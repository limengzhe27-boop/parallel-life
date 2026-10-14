import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement } from 'react';
// Handler regression harness only; real browser and PostgreSQL evidence is recorded separately.
let active: Harness;
class Harness {
  values: any[] = [];
  cursor = 0;
  cleanup: (() => void)[] = [];
  setups: (() => void | (() => void))[] = [];
  useState(initial: any) {
    const n = this.cursor++;
    if (!(n in this.values)) this.values[n] = typeof initial === 'function' ? initial() : initial;
    return [
      this.values[n],
      (v: any) => {
        this.values[n] = typeof v === 'function' ? v(this.values[n]) : v;
      },
    ];
  }
  useRef(initial: any) {
    const n = this.cursor++;
    if (!(n in this.values)) this.values[n] = { current: initial };
    return this.values[n];
  }
  useEffect(f: () => void | (() => void)) {
    const n = this.cursor++;
    if (!(n in this.values)) {
      this.values[n] = true;
      this.setups.push(f);
      const c = f();
      if (c) this.cleanup.push(c);
    }
  }
  render(p: Props) {
    active = this;
    this.cursor = 0;
    return walk(PublisherCharacterPasteDialog(p));
  }
}
Object.assign(globalThis, {
  __pasteHooks: {
    useState: (v: any) => active.useState(v),
    useRef: (v: any) => active.useRef(v),
    useEffect: (f: () => void | (() => void)) => active.useEffect(f),
  },
});
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('publisher-character-paste-dialog.tsx'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(
          readFileSync(new URL(url), 'utf8').replace(
            "import { useEffect, useRef, useState } from 'react';",
            'const {useEffect,useRef,useState}=globalThis.__pasteHooks;',
          ),
          {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2022,
              jsx: ts.JsxEmit.ReactJSX,
            },
          },
        ).outputText,
      };
    return next(url, context);
  },
});
const { PublisherCharacterPasteDialog } =
  await import('../src/features/publisher/publisher-character-paste-dialog.tsx');
type Props = Parameters<typeof PublisherCharacterPasteDialog>[0];
type Node = ReactElement<Record<string, any>>;
function walk(v: any): Node[] {
  if (Array.isArray(v)) return v.flatMap(walk);
  if (!isValidElement(v)) return [];
  const n = v as Node;
  return [n, ...walk(n.props.children)];
}
function text(v: any): string {
  if (Array.isArray(v)) return v.map(text).join('');
  if (isValidElement(v)) return text((v.props as any).children);
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}
function button(nodes: Node[], name: string) {
  const n = nodes.find((n) => n.type === 'button' && text(n) === name);
  assert.ok(n, name);
  return n;
}
function fixture() {
  const applied: any[] = [];
  const props: Props = {
    workId: 'one',
    version: 0,
    actorKey: 'lin',
    referenceAt: '2026-10-12T09:00:00Z',
    content: {
      world: { startAt: '2026-10-12T09:00:00Z' },
      actors: [
        { key: 'lin', name: '林白语', knownAtStart: true, lifeModules: { traits: '已有性格' } },
      ],
    },
    disabled: false,
    onClose() {},
    onApply: (...v: any[]) => {
      applied.push(v);
    },
  };
  return { props, applied, h: new Harness() };
}
function paste(h: Harness, p: Props, value: string) {
  let n = h.render(p);
  n.find((n) => n.type === 'textarea')!.props.onChange({ target: { value } });
  n = h.render(p);
  button(n, '识别并核对').props.onClick();
  return h.render(p);
}
test('preview is required, old field defaults unchecked, explicit confirm changes draft once with no service call', () => {
  const { h, props, applied } = fixture();
  let n = paste(h, props, '## 人格特质\n新的设定\n## 人生背景\n完整经历');
  assert.equal(applied.length, 0);
  const boxes = n.filter((n) => n.props.type === 'checkbox');
  assert.deepEqual(
    boxes.map((n) => n.props.checked),
    [false, true],
  );
  boxes[0]!.props.onChange({ target: { checked: true } });
  n = h.render(props);
  button(n, '确认填入当前人物').props.onClick();
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0].actors[0].lifeModules.traits, '新的设定\n');
  assert.match(applied[0][1], /尚未保存/);
  assert.doesNotMatch(text(n), /lifeModules|publicCard|JSON/);
});
test('name mismatch and unknown headings show exact source and disable confirmation', () => {
  const { h, props, applied } = fixture();
  const raw = '# 人物：别人\n## 未知章节\n无法丢失尾部';
  const n = paste(h, props, raw);
  assert.equal(button(n, '确认填入当前人物').props.disabled, true);
  assert.match(text(n), /别人/);
  assert.match(text(n), /无法丢失尾部/);
  button(n, '确认填入当前人物').props.onClick();
  assert.equal(applied.length, 0);
});
test('stale confirm callback checks latest props, work version, actor and readonly', () => {
  for (const update of [
    (p: Props) => ({ ...p, version: 1 }),
    (p: Props) => ({ ...p, actorKey: 'other' }),
    (p: Props) => ({ ...p, disabled: true }),
    (p: Props) => ({ ...p, content: { ...p.content, extra: 'later' } }),
  ]) {
    const { h, props, applied } = fixture();
    const n = paste(h, props, '## 人生背景\n设定');
    const old = button(n, '确认填入当前人物').props.onClick;
    h.render(update(props));
    old();
    assert.equal(applied.length, 0);
  }
});
test('new typing invalidates old preview and pending file cannot overwrite newer input', async () => {
  const { h, props, applied } = fixture();
  let resolve!: (v: ArrayBuffer) => void;
  const file = { size: 100, arrayBuffer: () => new Promise<ArrayBuffer>((r) => (resolve = r)) };
  let n = h.render(props);
  n.find((n) => n.props.type === 'file')!.props.onChange({ target: { files: [file], value: '' } });
  n = h.render(props);
  n.find((n) => n.type === 'textarea')!.props.onChange({
    target: { value: '## 人生背景\n新文字' },
  });
  resolve(new TextEncoder().encode('## 人生背景\n旧文件').buffer);
  await Promise.resolve();
  await Promise.resolve();
  n = h.render(props);
  assert.equal(n.find((n) => n.type === 'textarea')!.props.value, '## 人生背景\n新文字');
  assert.equal(applied.length, 0);
});
test('non UTF-8 file gives a visible error and preserves existing input', async () => {
  const { h, props } = fixture();
  let n = paste(h, props, '## 人生背景\n保留原文');
  n.find((n) => n.props.type === 'file')!.props.onChange({
    target: {
      files: [{ size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }],
      value: '',
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  n = h.render(props);
  assert.equal(n.find((n) => n.type === 'textarea')!.props.value, '## 人生背景\n保留原文');
  assert.ok(n.some((n) => n.props.role === 'alert'));
});

test('a detached confirmation cannot apply after input changes', () => {
  const { h, props, applied } = fixture();
  let n = paste(h, props, '## 人生背景\n旧原文');
  const old = button(n, '确认填入当前人物').props.onClick;
  n.find((n) => n.type === 'textarea')!.props.onChange({
    target: { value: '## 人生背景\n新原文' },
  });
  h.render(props);
  old();
  assert.equal(applied.length, 0);
});

test('valid UTF-8 file still loads after development effect cleanup/setup replay', async () => {
  const { h, props } = fixture();
  let n = h.render(props);
  h.cleanup.forEach((f) => f());
  h.setups.forEach((f) => f());
  n.find((n) => n.props.type === 'file')!.props.onChange({
    target: {
      files: [
        {
          size: 40,
          arrayBuffer: async () => new TextEncoder().encode('## 人生背景\n文件全文尾部').buffer,
        },
      ],
      value: '',
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  n = h.render(props);
  assert.equal(n.find((n) => n.type === 'textarea')!.props.value, '## 人生背景\n文件全文尾部');
  assert.equal(button(n, '识别并核对').props.disabled, false);
});
