import { useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneLink } from './types.ts';
import type { Operation } from './provider.tsx';
import { usePhoneApps } from './provider.tsx';
import s from './apps.module.css';
export function Links({ links, open }: { links?: PhoneLink[]; open: PhoneAppContext['open'] }) {
  return links?.length ? (
    <nav className={s.links} aria-label="关联内容">
      {links.map((l, i) => (
        <button
          type="button"
          key={`${l.app}:${l.target}:${i}`}
          onClick={() => open(l.app, l.target)}
        >
          {l.label} <span aria-hidden>↗</span>
        </button>
      ))}
    </nav>
  ) : null;
}
export function Feedback({
  operation,
  success = '已完成',
}: {
  operation?: Operation;
  success?: string;
}) {
  return operation?.busy ? (
    <p className={s.feedback} role="status">
      正在提交…
    </p>
  ) : operation?.error ? (
    <p className={s.error} role="alert">
      {operation.error}
    </p>
  ) : operation?.status === 'accepted' ? (
    <p className={s.feedback} role="status">
      请求已接收，正在等待处理结果。
    </p>
  ) : operation?.status === 'committed' ? (
    <p className={s.feedback} role="status">
      {success}
    </p>
  ) : null;
}
export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className={s.empty}>
      <span aria-hidden>○</span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}
export function Search({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className={s.search}>
      <span aria-hidden>⌕</span>
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Refresh() {
  const { onReload, loading } = usePhoneApps();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  return onReload ? (
    <span className={s.refresh}>
      <button
        disabled={busy || loading}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await onReload();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy || loading ? '刷新中…' : '刷新'}
      </button>
      {error && <small role="alert">刷新失败，请再试一次</small>}
    </span>
  ) : null;
}
export function Avatar({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={s.avatar}>
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : name.slice(0, 1)}
    </span>
  );
}
