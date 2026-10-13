import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultWallpaper, AUTHORIZED_WALLPAPERS } from '../src/features/phone/wallpaper.ts';
import { desktopApps } from '../src/features/phone/navigation.ts';

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

test('desktop dock includes all 5 functional core apps with no dead icons', () => {
  const dockApps = desktopApps.filter((app) => app !== 'scenes');
  assert.deepEqual(dockApps, ['messages', 'calendar', 'photos', 'notes', 'map']);
  assert.equal(dockApps.length, 5);

  // Each app must be a distinct valid functional feature
  const appSet = new Set(dockApps);
  assert.equal(appSet.size, 5);
  assert.ok(appSet.has('messages'), 'Messages (微信) must be in dock');
  assert.ok(appSet.has('calendar'), 'Calendar (日历) must be in dock');
  assert.ok(appSet.has('photos'), 'Photos (相册) must be in dock');
  assert.ok(appSet.has('notes'), 'Notes (备忘录) must be in dock');
  assert.ok(appSet.has('map'), 'Map (地图) must be in dock');
});
