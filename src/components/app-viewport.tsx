'use client';
import { useEffect } from 'react';
/** Shared sizing only. Experience stages are not navigation tabs. */
export function AppViewport() {
  useEffect(() => {
    const resize = () =>
      document.documentElement.style.setProperty(
        '--app-height',
        `${window.visualViewport?.height ?? innerHeight}px`,
      );
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
  return null;
}
