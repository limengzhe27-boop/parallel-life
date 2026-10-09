import s from './progress-state.module.css';
/** Reports the actual current operation; no invented percent or completion estimate. */
export function ProgressState({
  label,
  detail,
  busy = true,
}: {
  label: string;
  detail?: string;
  busy?: boolean;
}) {
  return (
    <div className={s.state} role="status" aria-live="polite" aria-atomic="true">
      {busy ? (
        <span className={s.spinner} aria-hidden="true" />
      ) : (
        <span className={s.dot} aria-hidden="true" />
      )}
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}
