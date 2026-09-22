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
    <g stroke="none">
      <path
        d="M19 5C11-1 0 4 1 12c0 3 2 6 5 8l-1 4 5-3c1 0 2 .4 3 .4 0-8 5-11 10-11A10 10 0 0 0 19 5Z"
        fill="var(--phone-white)"
      />
      <path
        d="M31 21c0-5-4-9-10-9s-10 4-10 9 4 9 10 9c1 0 3-.3 4-.8l4 2-1-4c2-1 3-4 3-6Z"
        fill="var(--phone-white)"
      />
      <circle cx="8" cy="10" r="1.4" fill="var(--phone-wechat)" />
      <circle cx="16" cy="10" r="1.4" fill="var(--phone-wechat)" />
      <circle cx="18" cy="20" r="1.3" fill="var(--phone-wechat)" />
      <circle cx="25" cy="20" r="1.3" fill="var(--phone-wechat)" />
    </g>
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
    <g stroke="none">
      {['red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'purple'].map((color, i) => (
        <ellipse
          key={color}
          cx="16"
          cy="8.4"
          rx="5.1"
          ry="7.5"
          transform={`rotate(${i * 45} 16 16)`}
          fill={`var(--phone-petal-${color})`}
          opacity=".85"
        />
      ))}
    </g>
  ),
  calendar: (
    <>
      <rect x="5" y="7" width="22" height="21" rx="4" />
      <path d="M5 13h22M11 4v6M21 4v6M11 18h3M19 18h3M11 23h3" />
    </>
  ),
  notes: (
    <g>
      <path d="M0 0h32v11H0z" fill="var(--phone-note-yellow)" stroke="none" />
      <path d="M0 12h32" stroke="var(--phone-rule)" strokeWidth=".4" strokeDasharray="1 1" />
      <path d="M0 19h32M0 25h32M0 31h32" stroke="var(--phone-rule)" strokeWidth=".4" />
    </g>
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
