import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(
  new URL('../src/features/phone/phone.module.css', import.meta.url),
  'utf8',
);
const shell = readFileSync(
  new URL('../src/features/phone/phone-shell.tsx', import.meta.url),
  'utf8',
);
const messages = readFileSync(
  new URL('../src/features/phone/apps/messages.tsx', import.meta.url),
  'utf8',
);

test('a private-chat banner sits below the chat header and keeps message width', () => {
  const banner = css.match(/^\.banner \{[^}]*\}/m)?.[0] ?? '';
  assert.match(banner, /position:\s*relative/);
  assert.match(banner, /flex-shrink:\s*0/);
  assert.doesNotMatch(banner, /position:\s*absolute|top:\s*calc\(100% \+ 8px\)/);
  const chatBanner = css.match(/^\.bannerChat \{[^}]*\}/m)?.[0] ?? '';
  assert.match(chatBanner, /width:\s*min\(100%, 340px\)/);
  assert.match(chatBanner, /align-self:\s*flex-start/);
  assert.match(shell, /bannerInChat/);
  assert.match(shell, /banner:\s*bannerNode/);
  assert.match(messages, /\{banner\}\s*\{\/\* 消息滚动流 \*\//);
});

test('WeChat top bar keeps the plus action but drops the redundant search icon', () => {
  const start = messages.indexOf('原生微信顶栏 NavBar');
  const end = messages.indexOf('主体滚动区域');
  assert.ok(start >= 0 && end > start);
  const nav = messages.slice(start, end);
  assert.match(nav, /更多功能/);
  assert.match(nav, /⊕/);
  assert.doesNotMatch(nav, /🔍/);
  assert.doesNotMatch(nav, /wechat-search-input/);
});
