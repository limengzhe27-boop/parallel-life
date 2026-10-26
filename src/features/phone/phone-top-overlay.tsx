'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Put app-owned notifications in this phone's top layer without resizing the app. */
export function PhoneTopOverlay({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(
      anchor.current
        ?.closest('[data-phone-content]')
        ?.querySelector<HTMLElement>('[data-phone-top-overlays]') ?? null,
    );
  }, []);
  return (
    <>
      <span ref={anchor} hidden aria-hidden="true" />
      {host && createPortal(children, host)}
    </>
  );
}
