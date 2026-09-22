import type { ReactNode } from 'react';
import type { PhoneApp, PhonePanel } from './navigation.ts';
const shapes: Record<PhoneApp | PhonePanel | 'home' | 'back' | 'next', ReactNode> = {
  management: (
    <>
      <circle cx="16" cy="16" r="10" />
      <circle cx="16" cy="16" r="4" />
      <path d="M16 3v4M16 25v4M3 16h4M25 16h4" />
    </>
  ),
  messages: (
    <>
      <path d="M5 5h22v16H15l-7 6v-6H5z" fill="currentColor" stroke="none" />
      <path d="M10 11h12M10 15h8" stroke="var(--phone-message-ink, var(--success))" />
    </>
  ),
  moments: (
    <>
      <circle cx="16" cy="16" r="4" fill="currentColor" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse
          key={a}
          cx="16"
          cy="7"
          rx="3"
          ry="5"
          fill="currentColor"
          stroke="none"
          transform={`rotate(${a} 16 16)`}
        />
      ))}
    </>
  ),
  photos: (
    <>
      <rect x="5" y="5" width="22" height="22" rx="5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="m6 24 7-8 5 5 4-6 5 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="5" y="7" width="22" height="21" rx="4" />
      <path d="M5 13h22M11 4v6M21 4v6M11 18h3M19 18h3M11 23h3" />
    </>
  ),
  notes: (
    <>
      <path d="M8 4h16v24H8z" fill="currentColor" stroke="none" />
      <path d="M12 11h8M12 16h8M12 21h5" stroke="var(--phone-note-ink, var(--warning))" />
    </>
  ),
  schedule: (
    <>
      <circle cx="16" cy="16" r="11" />
      <path d="M16 9v8l5 3" />
    </>
  ),
  timeline: (
    <>
      <path d="M7 5v22M7 10h8M7 22h13" />
      <circle cx="7" cy="10" r="3" fill="currentColor" />
      <circle cx="7" cy="22" r="3" fill="currentColor" />
      <path d="m18 8 6 4-6 4" />
    </>
  ),
  director: (
    <>
      <rect x="5" y="11" width="22" height="16" rx="3" />
      <path d="m5 11 21-5-1-4L4 7zM10 6l4 4M19 4l4 4m-10 9 7 4-7 4z" />
    </>
  ),
  home: (
    <>
      <path d="m5 14 11-9 11 9M8 12v15h16V12M14 27v-8h4v8" />
    </>
  ),
  back: <path d="m19 7-9 9 9 9" />,
  next: <path d="m13 7 9 9-9 9" />,
};
export function PhoneIcon({ name }: { name: keyof typeof shapes }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
