import styles from './phone.module.css';
export function LockGlyph() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="12" height="10" rx="3" fill="currentColor" />
      <path d="M5.5 10V6a3.5 3.5 0 0 1 7 0v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
/** Decorative virtual handset indicators, not device telemetry. */
export function StatusBar({
  timeLabel,
  locked,
  onLock,
}: {
  timeLabel: string;
  locked: boolean;
  onLock: () => void;
}) {
  return (
    <div className={styles.statusBar} data-phone-status>
      <span className={styles.statusTime}>
        {locked ? <span className={styles.srOnly}>手机已锁定</span> : timeLabel}
      </span>
      <button
        className={styles.island}
        aria-label={locked ? '手机已锁定' : '锁定手机'}
        disabled={locked}
        onClick={onLock}
        title={locked ? '手机已锁定' : '锁定手机'}
      >
        <span className={styles.islandPill}>
          {locked ? <LockGlyph /> : <span className={styles.lens} />}
        </span>
      </button>
      <span className={styles.indicators} aria-label="虚拟手机状态图示，非设备实测">
        <svg width="18" height="14" viewBox="0 0 18 14" fill="currentColor" aria-hidden="true">
          <rect x="0" y="9" width="3" height="5" rx=".8" />
          <rect x="5" y="6" width="3" height="8" rx=".8" />
          <rect x="10" y="3" width="3" height="11" rx=".8" />
          <rect x="15" y="0" width="3" height="14" rx=".8" />
        </svg>
        <svg
          width="18"
          height="14"
          viewBox="0 0 20 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 5a12 12 0 0 1 16 0M5 9a7 7 0 0 1 10 0M8 12a3 3 0 0 1 4 0" />
          <circle cx="10" cy="15" r="1" fill="currentColor" stroke="none" />
        </svg>
        <svg width="27" height="14" viewBox="0 0 29 15" aria-hidden="true">
          <rect
            x=".75"
            y=".75"
            width="24"
            height="13.5"
            rx="3.5"
            fill="none"
            stroke="currentColor"
            opacity=".55"
          />
          <rect x="3" y="3" width="19" height="9" rx="1.5" fill="currentColor" />
          <path d="M26 5v5a3 3 0 0 0 0-5" fill="currentColor" opacity=".6" />
        </svg>
      </span>
    </div>
  );
}
