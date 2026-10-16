import { resolveWorldLifeArt } from '../discovery/life-art.ts';

/**
 * Branch-aware wallpaper resolution for authorized art assets.
 * Strictly adheres to privacy: uses only generic authorized illustrations/photography,
 * never uses private user photos.
 */
export const AUTHORIZED_WALLPAPERS = [
  '/art/first-window.webp',
  '/art/open-door.webp',
  '/art/meadow-door.webp',
  '/art/lives/county-yellow-hair-wallpaper.svg',
  '/art/lives/only-child-wallpaper.svg',
  '/art/lives/returned-daughter-wallpaper.svg',
  '/art/lives/retired-star-wallpaper.svg',
] as const;

export function resolveDefaultWallpaper(title?: string, identity?: string): string {
  const official = resolveWorldLifeArt({ title, identity });
  if (official) return official.wallpaperUrl;
  if (!title) return '/art/first-window.webp';
  if (/摩托|小镇|县城|车间|修车/i.test(title)) {
    return '/art/open-door.webp';
  }
  if (/独生|女儿|归来|山海|春暖|草地/i.test(title)) {
    return '/art/meadow-door.webp';
  }
  return '/art/first-window.webp';
}
