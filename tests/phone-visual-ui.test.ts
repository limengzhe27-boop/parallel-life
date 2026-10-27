import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultWallpaper, AUTHORIZED_WALLPAPERS } from '../src/features/phone/wallpaper.ts';
import { homeAppRows, homeDockApps } from '../src/features/phone/home-app-layout.ts';

test('resolveDefaultWallpaper resolves branch-specific authorized art and falls back safely', () => {
  // Motor / workshop branch
  assert.equal(resolveDefaultWallpaper('平行世界：县城摩托车间'), '/art/open-door.webp');
  assert.equal(resolveDefaultWallpaper('小镇修车行的青春'), '/art/open-door.webp');

  // Daughter / homecoming branch
  assert.equal(resolveDefaultWallpaper('平行世界：独生女的归来'), '/art/meadow-door.webp');
  assert.equal(resolveDefaultWallpaper('春暖花开，重返故乡草地'), '/art/meadow-door.webp');

  // Default / fallback
  assert.equal(resolveDefaultWallpaper('未知旅程的新起点'), '/art/first-window.webp');
  assert.equal(resolveDefaultWallpaper(undefined), '/art/first-window.webp');
  assert.equal(resolveDefaultWallpaper(''), '/art/first-window.webp');

  // All wallpapers must belong to the authorized list
  for (const title of ['县城修车', '女儿归来', '漫步都市', '']) {
    const wp = resolveDefaultWallpaper(title);
    assert.ok(
      (AUTHORIZED_WALLPAPERS as readonly string[]).includes(wp),
      `Wallpaper ${wp} must be in authorized list`,
    );
  }
});

test('home has five desktop entries and three independent dock applications', () => {
  assert.deepEqual(homeDockApps, ['messages', 'scenes', 'map']);
  assert.deepEqual(
    homeAppRows.map((row) => row.map((entry) => entry.label)),
    [
      ['日历', '相册', '备忘录'],
      ['记录', '身份'],
    ],
  );
  assert.equal(homeAppRows.flat().length + homeDockApps.length, 8);
});
