import type { ReactNode } from 'react';
import type { PhoneApp, PhonePanel } from './navigation.ts';
const shapes: Record<PhoneApp | PhonePanel | 'home' | 'back' | 'next', ReactNode> = {
  map: (
    <>
      <path d="m3 7 8-3 10 4 8-3v20l-8 3-10-4-8 3ZM11 4v20M21 8v20" />
      <circle cx="18" cy="14" r="3" />
    </>
  ),
  scenes: <path d="M4 26V8l12-4 12 4v18M10 26V13h12v13M16 13v13" />,
  scene: (
    <>
      <path d="M4 26V8l12-4 12 4v18M10 26V13h12v13M16 13v13" />
    </>
  ),
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
  time: (
    <>
      <circle cx="16" cy="16" r="11" />
      <path d="M16 8v9l6 3" />
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
const appFaces: Partial<Record<keyof typeof shapes, ReactNode>> = {
  messages: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#15c65e" />
      <path
        d="M20.5 7.8C14.4 3.1 4.1 6.1 4.1 12.7c0 2.4 1.4 4.5 3.6 5.8l-.8 3 3.5-1.7c.7.2 1.5.3 2.3.3-.1-5 3.7-8.4 9.1-8.3a7.1 7.1 0 0 0-1.3-4Z"
        fill="#fff"
      />
      <path
        d="M28.2 20c0-4.1-3.5-7.3-7.9-7.3s-7.9 3.2-7.9 7.3 3.5 7.3 7.9 7.3c1 0 2-.2 2.8-.5l2.8 1.3-.6-2.6a6.9 6.9 0 0 0 2.9-5.5Z"
        fill="#fff"
      />
      <circle cx="10" cy="11" r="1" fill="#15c65e" />
      <circle cx="16.2" cy="11" r="1" fill="#15c65e" />
      <circle cx="17.7" cy="18.4" r=".9" fill="#15c65e" />
      <circle cx="23.3" cy="18.4" r=".9" fill="#15c65e" />
    </g>
  ),
  photos: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#fff" />
      {['#f64d5e', '#ff9431', '#ffcc35', '#adc94c', '#57be7a', '#5ac2cc', '#5489df', '#ac68c9'].map(
        (color, i) => (
          <ellipse
            key={color}
            cx="16"
            cy="10.2"
            rx="4.6"
            ry="6.8"
            transform={`rotate(${i * 45} 16 16)`}
            fill={color}
            opacity=".82"
          />
        ),
      )}
    </g>
  ),
  notes: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#fffef9" />
      <path d="M7 0h18a7 7 0 0 1 7 7v3H0V7a7 7 0 0 1 7-7Z" fill="#f7cc46" />
      <path d="M0 10.6h32" stroke="#d2bd78" strokeWidth=".35" strokeDasharray=".4 1" />
      <path d="M0 16.5h32M0 22.5h32M0 28.5h32" stroke="#d6d6d0" strokeWidth=".35" />
    </g>
  ),
  map: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#eef4e8" />
      <path d="M0 21 32 8M9 0l5 32" stroke="#fff" strokeWidth="5" />
      <path d="M0 21 32 8" stroke="#f4ce71" strokeWidth="2" />
      <path d="M22 7a6 6 0 0 0-6 6c0 5 6 11 6 11s6-6 6-11a6 6 0 0 0-6-6Z" fill="#4085e5" />
      <circle cx="22" cy="13" r="2" fill="#fff" />
    </g>
  ),
  scenes: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#447f77" />
      <rect x="6" y="11" width="20" height="15" rx="2.5" fill="#fff" />
      <path d="m5.6 9.5 19.7-4.7 1.1 4.6-19.7 4.7Z" fill="#ecf7f4" />
      <path d="m9.5 8.6 3.6 4M17.1 6.8l3.6 4" stroke="#447f77" strokeWidth="2.4" />
      <path d="m13 15 7 4-7 4Z" fill="#447f77" />
    </g>
  ),
  timeline: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#5085c8" />
      <rect x="5" y="5" width="22" height="22" rx="3" fill="#edf4ff" />
      <circle cx="16" cy="12" r="4" fill="#5085c8" />
      <path d="M9 24v-2a7 7 0 0 1 14 0v2Z" fill="#5085c8" />
      <path d="M5 9h2M5 14h2M5 19h2" stroke="#8daedb" strokeWidth="1" />
    </g>
  ),
  time: (
    <g stroke="none">
      <rect width="32" height="32" rx="7" fill="#17191f" />
      <circle cx="16" cy="16" r="12.4" fill="#fafafa" />
      <path d="M16 5v1.5M16 25.5V27M5 16h1.5M25.5 16H27" stroke="#25272c" strokeWidth="1" />
      <path d="M16 8.7v7.8l5.6 3.1" stroke="#25272c" strokeWidth="1.8" />
      <path d="M16 6.8v16" stroke="#e7514d" strokeWidth=".55" />
      <circle cx="16" cy="16" r="1.2" fill="#e7514d" />
    </g>
  ),
};
export function PhoneIcon({
  name,
  variant = 'glyph',
}: {
  name: keyof typeof shapes;
  variant?: 'glyph' | 'app';
}) {
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
      {variant === 'app' ? (appFaces[name] ?? shapes[name]) : shapes[name]}
    </svg>
  );
}
