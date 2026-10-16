import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PhoneAppContext } from '../src/features/phone/phone-shell.tsx';
import type { PhoneContact, PhoneMessage } from '../src/features/phone/apps/types.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/provider.tsx'))
      return { url: 'wechat19-test:provider', shortCircuit: true };
    if (specifier.endsWith('/use-groups.ts'))
      return { url: 'wechat19-test:groups', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'wechat19-test:provider')
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const usePhoneApps=()=>globalThis.__wechat19Context',
      };
    if (url === 'wechat19-test:groups')
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const useGroups=()=>({enabled:false,details:{},list:{groups:[]}})',
      };
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('.tsx') && !url.includes('/node_modules/')) {
      let source = readFileSync(new URL(url), 'utf8');
      if (url.endsWith('/messages.tsx'))
        source = source.replace(
          "import { useEffect, useLayoutEffect, useRef, useState } from 'react';",
          'const useState=v=>globalThis.__wechat19Hooks.state(v); const useRef=v=>({current:v}); const useEffect=(fn,deps)=>globalThis.__wechat19Hooks.messageEffect(fn,deps); const useLayoutEffect=()=>{};',
        );
      if (url.endsWith('/moments.tsx'))
        source = source.replace(
          "import { useEffect, useState } from 'react';",
          'const useState=v=>globalThis.__wechat19Hooks.state(v); const useEffect=(fn,deps)=>globalThis.__wechat19Hooks.effect(fn,deps);',
        );
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { MessagesApp } = await import('../src/features/phone/apps/messages.tsx');
const { MomentsApp } = await import('../src/features/phone/apps/moments.tsx');
function nodes(value: unknown): ReactElement<Record<string, any>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const e = value as ReactElement<Record<string, any>>;
  return [e, ...nodes(e.props.children)];
}
const one = 'npc-one',
  two = 'npc-two';
function harness(
  component: typeof MomentsApp | typeof MessagesApp,
  target?: string,
  transport?: typeof fetch,
) {
  let cursor = 0;
  const states: any[] = [],
    opened: unknown[][] = [];
  let deps: readonly unknown[] | undefined,
    cleanup: (() => void) | undefined,
    pending: (() => void | (() => void)) | undefined,
    profileEffect: (() => void | (() => void)) | undefined;
  const context = {
    worldId: 'private-world',
    transport,
    data: {
      contacts: [
        { id: one, name: '同名朋友', relationship: '搭档', unread: 0 },
        { id: two, name: '同名朋友', relationship: '熟人', unread: 0 },
      ] as PhoneContact[],
      messages: [] as PhoneMessage[],
      invitations: [],
      photos: [],
      notes: [],
    },
    actions: {},
    drafts: {},
    setDraft() {},
    operations: {},
    run() {},
  };
  Object.assign(globalThis, {
    __wechat19Context: context,
    __wechat19Hooks: {
      state(value: any) {
        const i = cursor++;
        if (!(i in states)) states[i] = typeof value === 'function' ? value() : value;
        return [
          states[i],
          (next: any) => {
            states[i] = typeof next === 'function' ? next(states[i]) : next;
          },
        ];
      },
      effect(fn: typeof pending, next: readonly unknown[]) {
        if (!deps || next.some((v, i) => v !== deps![i])) {
          deps = next;
          pending = fn;
        }
      },
      messageEffect(fn: typeof profileEffect, next: readonly unknown[]) {
        if (next.length === 4 && (next[1] === one || next[1] === two)) profileEffect = fn;
      },
    },
  });
  const props: PhoneAppContext = {
    app: component === MomentsApp ? 'moments' : 'messages',
    target,
    open: (...args) => {
      opened.push(args);
    },
  };
  const tree = () => {
    cursor = 0;
    return component(props);
  };
  const render = () => nodes(tree());
  return {
    context,
    props,
    states,
    opened,
    render,
    html: () => renderToStaticMarkup(tree()),
    flush: async () => {
      if (pending) {
        cleanup?.();
        cleanup = pending() || undefined;
        pending = undefined;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    flushProfile: async () => {
      profileEffect?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    close() {
      cleanup?.();
      Reflect.deleteProperty(globalThis, '__wechat19Context');
      Reflect.deleteProperty(globalThis, '__wechat19Hooks');
    },
  };
}
const posts = {
  moments: [
    {
      key: 'own',
      actorId: one,
      name: '同名朋友',
      text: '  这是实际保存的正文\n<script>不执行</script>  ',
      at: '2026-10-13T01:00:00.000Z',
    },
    {
      key: 'other',
      actorId: two,
      name: '同名朋友',
      text: '另一位同名人物的动态',
      at: '2026-10-13T02:00:00.000Z',
    },
  ],
};

test('chat opens a full friend profile with one moments entry bound to the actual actor id', () => {
  const h = harness(MessagesApp, one);
  try {
    let buttons = h
      .render()
      .filter((n) => n.type === 'button' && n.props['aria-label'] === '查看同名朋友的朋友圈');
    assert.equal(buttons.length, 1);
    buttons[0]!.props.onClick();
    assert.deepEqual(h.opened, [['moments', one]]);
    const profile = h
      .render()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '查看同名朋友的人物资料');
    assert.ok(profile);
    profile.props.onClick();
    buttons = h
      .render()
      .filter((n) => n.type === 'button' && n.props['aria-label'] === '查看同名朋友的朋友圈');
    assert.equal(buttons.length, 1);
    assert.match(h.html(), /朋友资料/);
    buttons[0]!.props.onClick();
    assert.deepEqual(h.opened.at(-1), ['moments', one]);
    assert.equal(
      h.render().filter((n) => n.props['aria-label'] === '查看同名朋友的朋友圈').length,
      1,
    );
  } finally {
    h.close();
  }
});

test('friend profile shows only the selected contact public introduction, and back restores that chat', () => {
  const h = harness(MessagesApp, one);
  try {
    h.context.data.contacts[0]!.summary = '公开介绍：她在海边经营一间小店。';
    h.context.data.contacts[1]!.summary = '另一个同名人物的介绍';
    h.context.data.messages.push({
      id: 'actual-history',
      actorId: one,
      role: 'assistant',
      text: '你想喝点什么？',
      at: '2026-10-13T01:00:00.000Z',
      status: 'sent',
    });
    const avatar = h
      .render()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '查看同名朋友的好友资料');
    assert.ok(avatar);
    avatar.props.onClick();
    const html = h.html();
    assert.match(html, /朋友资料|公开介绍：她在海边经营一间小店/);
    assert.doesNotMatch(html, /另一个同名人物的介绍|● 在线|人物生平与性格/);
    const back = h
      .render()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '返回上一页');
    assert.ok(back);
    back.props.onClick();
    assert.match(h.html(), /你想喝点什么/);
    assert.deepEqual(h.opened, []);
  } finally {
    h.close();
  }
});

test('friend profile previews saved social posts for the exact actor without showing a same-name contact post', async () => {
  const requested: string[] = [];
  const h = harness(MessagesApp, one, (async (url: string) => {
    requested.push(url);
    return new Response(JSON.stringify(posts));
  }) as typeof fetch);
  try {
    h.render()
      .find((n) => n.props['aria-label'] === '查看同名朋友的人物资料')!
      .props.onClick();
    assert.equal(h.states[3], true);
    h.render();
    assert.match(h.html(), /朋友资料/);
    await h.flushProfile();
    const html = h.html();
    assert.equal(requested[0], '/api/v1/worlds/private-world/social');
    assert.match(html, /这是实际保存的正文/);
    assert.doesNotMatch(html, /另一位同名人物的动态|<script>/);
    h.render()
      .find((n) => n.props['aria-label'] === '查看同名朋友的朋友圈')!
      .props.onClick();
    assert.deepEqual(h.opened, [['moments', one]]);
  } finally {
    h.close();
  }
});

test('address book namecard uses the selected actor id even when two contacts have identical names', () => {
  const h = harness(MessagesApp);
  try {
    h.states[1] = 'contacts';
    const row = h.render().find((n) => n.type === 'button' && n.key === two);
    assert.ok(row);
    row.props.onClick();
    const moments = h
      .render()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '查看同名朋友的朋友圈');
    assert.ok(moments);
    moments.props.onClick();
    assert.deepEqual(h.opened, [['moments', two]]);
  } finally {
    h.close();
  }
});

test('targeted moments reads the persisted social API, renders exact escaped body and returns to the same NPC', async () => {
  const urls: string[] = [];
  const transport = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(posts), { status: 200 });
  }) as typeof fetch;
  const h = harness(MomentsApp, one, transport);
  try {
    assert.match(h.html(), /正在读取动态/);
    await h.flush();
    const html = h.html();
    assert.equal(urls[0], '/api/v1/worlds/private-world/social');
    assert.match(html, /同名朋友的朋友圈/);
    assert.match(html, /这是实际保存的正文/);
    assert.match(html, /&lt;script&gt;不执行&lt;\/script&gt;/);
    assert.doesNotMatch(html, /另一位同名人物的动态|<script>/);
    const back = h
      .render()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '返回同名朋友的聊天');
    assert.ok(back);
    back.props.onClick();
    assert.deepEqual(h.opened, [['messages', one]]);
    h.props.target = two;
    assert.match(h.html(), /另一位同名人物的动态/);
    assert.doesNotMatch(h.html(), /这是实际保存的正文/);
  } finally {
    h.close();
  }
});

test('all moments remain available from the existing feed, while target empty and errors never fabricate content', async () => {
  const all = harness(
    MomentsApp,
    undefined,
    (async () => new Response(JSON.stringify(posts))) as typeof fetch,
  );
  try {
    all.render();
    await all.flush();
    assert.match(all.html(), /这是实际保存的正文/);
    assert.match(all.html(), /另一位同名人物的动态/);
  } finally {
    all.close();
  }
  const empty = harness(
    MomentsApp,
    one,
    (async () => new Response(JSON.stringify({ moments: [] }))) as typeof fetch,
  );
  try {
    empty.render();
    await empty.flush();
    assert.match(empty.html(), /同名朋友还没有动态/);
    assert.doesNotMatch(empty.html(), /这是实际保存的正文/);
  } finally {
    empty.close();
  }
  let attempt = 0;
  const error = harness(MomentsApp, one, (async () => {
    attempt++;
    return attempt === 1
      ? new Response('unavailable', { status: 503 })
      : new Response(JSON.stringify(posts));
  }) as typeof fetch);
  try {
    error.render();
    await error.flush();
    assert.match(error.html(), /动态暂时没能读取/);
    assert.doesNotMatch(error.html(), /这是实际保存的正文/);
    const retry = error.render().find((n) => n.type === 'button' && n.props.children === '重试');
    assert.ok(retry);
    retry.props.onClick();
    error.render();
    await error.flush();
    assert.match(error.html(), /这是实际保存的正文/);
  } finally {
    error.close();
  }
});

test('switching worlds hides prior posts before the new request resolves', async () => {
  const h = harness(
    MomentsApp,
    one,
    (async () => new Response(JSON.stringify(posts))) as typeof fetch,
  );
  try {
    h.render();
    await h.flush();
    assert.match(h.html(), /这是实际保存的正文/);
    h.context.worldId = 'different-world';
    assert.doesNotMatch(h.html(), /这是实际保存的正文/);
    assert.match(h.html(), /正在读取动态/);
  } finally {
    h.close();
  }
});

test('an aborted old-world response cannot overwrite the loaded new-world feed', async () => {
  let finishOld!: (response: Response) => void;
  const fresh = { moments: [{ ...posts.moments[0]!, text: '新世界已保存的动态' }] };
  const transport = (async (url: string) =>
    url.includes('private-world')
      ? new Promise<Response>((resolve) => {
          finishOld = resolve;
        })
      : new Response(JSON.stringify(fresh))) as typeof fetch;
  const h = harness(MomentsApp, one, transport);
  try {
    h.render();
    await h.flush();
    h.context.worldId = 'different-world';
    h.render();
    await h.flush();
    assert.match(h.html(), /新世界已保存的动态/);
    finishOld(new Response(JSON.stringify(posts)));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(h.html(), /新世界已保存的动态/);
    assert.doesNotMatch(h.html(), /这是实际保存的正文/);
  } finally {
    h.close();
  }
});
