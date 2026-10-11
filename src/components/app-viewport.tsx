'use client';
import { useEffect } from 'react';
import { viewportGeometry } from './viewport-geometry.ts';
/** Keep the shared App viewport within the available screen height. */
export function AppViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const resize = () => {
      const viewport = window.visualViewport;
      const geometry = viewportGeometry({
        height: viewport?.height ?? innerHeight,
        offsetTop: viewport?.offsetTop ?? 0,
        scale: viewport?.scale ?? 1,
        fallbackHeight: innerHeight,
      });
      if (!geometry.track) return;
      root.dataset.appViewport = 'tracked';
      root.style.setProperty('--app-height', `${geometry.height}px`);
      root.style.setProperty('--app-top', `${geometry.top}px`);
    };
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-top');
      delete root.dataset.appViewport;
    };
  }, []);
  return null;
}
