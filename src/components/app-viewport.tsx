'use client';
import { useEffect } from 'react';
/** Keep the shared App viewport within the available screen height. */
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
