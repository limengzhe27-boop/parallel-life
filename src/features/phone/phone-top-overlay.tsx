'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Prefer the device layer; character trials use their existing positioned chat as fallback. */
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
      {host ? (
        createPortal(children, host)
      ) : (
        <div
          style={{
            position: 'absolute',
            top: 8,
            insetInline: 12,
            zIndex: 200,
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}
