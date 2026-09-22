'use client';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
export type IconName =
  | 'arrow'
  | 'plus'
  | 'user'
  | 'edit'
  | 'check'
  | 'close'
  | 'spark'
  | 'chat'
  | 'lock'
  | 'photo'
  | 'chevron'
  | 'send'
  | 'clock'
  | 'book'
  | 'refresh';
const shapes: Record<IconName, ReactNode> = {
  arrow: (
    <>
      <path d="M4 12h16M14 6l6 6-6 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0116 0v2" />
    </>
  ),
  edit: (
    <>
      <path d="M16 4l4 4M4 20l5-1L20 8a3 3 0 00-4-4L5 15z" />
    </>
  ),
  check: <path d="M5 12l4 4L20 5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  spark: (
    <>
      <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
    </>
  ),
  chat: <path d="M20 15a3 3 0 01-3 3H9l-5 3V6a3 3 0 013-3h10a3 3 0 013 3z" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 018 0v3M12 14v3" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="M3 17l5-5 4 4 4-6 5 6" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  send: <path d="M12 20V4M5 11l7-7 7 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  book: (
    <>
      <path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 10a8 8 0 10-1 7M20 4v6h-6" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="如果，回到认识我">
      <svg width="34" height="40" viewBox="0 0 34 40" fill="none" aria-hidden="true">
        <path
          d="M5 34V6l20-4v32M10 34V11l19-4v27M2 35h30"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
      <span>
        如果<small>PARALLEL LIFE</small>
      </span>
    </a>
  );
}
export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button {...props} className={`button ${variant} ${className}`}>
      {children}
    </button>
  );
}
export function Modal({
  open,
  onClose,
  title,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    else if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-panel">
        <header className="dialog-header">
          <h2>{title}</h2>
          <Button variant="ghost" className="icon-button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Notice({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info' | 'success';
}) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
