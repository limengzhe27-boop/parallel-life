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

test('all phone banners share the top overlay without taking app layout space', () => {
  const overlay = css.match(/^\.topOverlays \{[^}]*\}/m)?.[0] ?? '';
  assert.match(overlay, /position:\s*absolute/);
  assert.match(overlay, /top:\s*calc\(100% \+ 8px\)/);
  assert.match(overlay, /pointer-events:\s*none/);
  assert.match(css, /\.topOverlays > \*\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(shell, /<StatusBar[^]*?data-phone-top-overlays hidden=\{locked\}>\s*\{bannerNode\}/);
  assert.doesNotMatch(shell, /bannerInChat|bannerChat/);
  assert.doesNotMatch(messages, /\{banner\}/);
  assert.match(messages, /<PhoneTopOverlay>[^]*?\{invitationBanner\}[^]*?<\/PhoneTopOverlay>/);
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
