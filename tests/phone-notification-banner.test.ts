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

test('incoming message banners sit directly below the phone status bar', () => {
  const banner = css.match(/^\.banner \{[^}]*\}/m)?.[0] ?? '';
  assert.match(banner, /top:\s*calc\(100% \+ 8px\)/);
  assert.doesNotMatch(banner, /152px|env\(safe-area-inset-top\)/);
  assert.match(css, /\.statusLayer \{[^}]*position: relative;[^}]*flex-shrink: 0;/s);
  assert.doesNotMatch(css, /:has\(> \.notice\) \.banner/);
  assert.match(
    shell,
    /<div className=\{styles\.statusLayer\}>\s*<StatusBar[\s\S]*?data-notification-banner[\s\S]*?<\/div>\s*<div className=\{styles\.unlockedContent\}/,
  );
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
