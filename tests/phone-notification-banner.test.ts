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

test('incoming message banners sit below the status bar and push page content down', () => {
  const banner = css.match(/^\.banner \{[^}]*\}/m)?.[0] ?? '';
  assert.match(banner, /position:\s*relative/);
  assert.match(banner, /flex-shrink:\s*0/);
  assert.match(banner, /margin:\s*0 12px 8px/);
  assert.doesNotMatch(banner, /position:\s*absolute|top:\s*calc\(100% \+ 8px\)/);
  assert.match(css, /\.statusLayer \{[^}]*position: relative;[^}]*flex-shrink: 0;/s);
  assert.doesNotMatch(css, /:has\(> \.notice\) \.banner/);
  assert.match(
    shell,
    /<div className=\{styles\.statusLayer\}>\s*<StatusBar[\s\S]*?<\/div>\s*\{banner && !locked && \(\s*<div className=\{styles\.banner\}/,
  );
  assert.match(shell, /<\/div>\s*\)\}\s*<div className=\{styles\.unlockedContent\}/);
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
