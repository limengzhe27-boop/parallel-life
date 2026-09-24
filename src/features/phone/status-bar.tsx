import styles from './phone.module.css';

export function LockGlyph() {
  return (
    <svg width="14" height="16" viewBox="0 0 18 22" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="12" height="10" rx="3" fill="currentColor" />
      <path d="M5.5 10V6a3.5 3.5 0 0 1 7 0v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * 手机状态栏（StatusBar）
 * 遵循真实手机规范：左侧时间、居中克制微型药丸传感器孔（灵动岛）、右侧 5G/Wi-Fi/精细电量胶囊
 */
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
      {/* 左侧：手机时钟 */}
      <span className={styles.statusTime} style={{ fontWeight: 600, letterSpacing: '-0.2px' }}>
        {locked ? <span className={styles.srOnly}>手机已锁定</span> : timeLabel}
      </span>

      {/* 中部：微型药丸摄像头与传感器（克制雅致，不再强行承载业务干扰） */}
      <button
        className={styles.island}
        aria-label={locked ? '手机已锁定' : '锁屏'}
        disabled={locked}
        onClick={onLock}
        title={locked ? '手机已锁定' : '锁屏'}
        style={{ cursor: locked ? 'default' : 'pointer' }}
      >
        <span className={styles.islandPill}>
          {locked ? (
            <LockGlyph />
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={styles.lens} style={{ marginLeft: 0 }} />
              <span
                style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.25)',
                }}
              />
            </span>
          )}
        </span>
      </button>

      {/* 右侧：5G、Wi-Fi与电池电量百分比 */}
      <span className={styles.indicators} aria-label="移动网络 5G，Wi-Fi 已连接，电量 98%">
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '-0.3px',
            marginRight: '1px',
            opacity: 0.9,
          }}
        >
          5G
        </span>

        {/* 满格蜂窝信号阶梯 */}
        <svg width="15" height="11" viewBox="0 0 18 14" fill="currentColor" aria-hidden="true">
          <rect x="0" y="9" width="3" height="5" rx=".8" />
          <rect x="5" y="6" width="3" height="8" rx=".8" />
          <rect x="10" y="3" width="3" height="11" rx=".8" />
          <rect x="15" y="0" width="3" height="14" rx=".8" />
        </svg>

        {/* 满格 Wi-Fi 图标 */}
        <svg
          width="15"
          height="11"
          viewBox="0 0 20 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 5a12 12 0 0 1 16 0M5 9a7 7 0 0 1 10 0M8 12a3 3 0 0 1 4 0" />
          <circle cx="10" cy="15" r="1.2" fill="currentColor" stroke="none" />
        </svg>

        {/* 精细电池胶囊与电量填充条 */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            position: 'relative',
          }}
          title="电量 98%"
        >
          <svg width="24" height="12" viewBox="0 0 26 13" aria-hidden="true">
            <rect
              x="0.75"
              y="0.75"
              width="21.5"
              height="11.5"
              rx="3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity=".6"
            />
            {/* 绿色充沛电量填充 */}
            <rect x="2.5" y="2.5" width="18" height="8" rx="1.5" fill="#22c55e" />
            <path d="M24 4.5v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".6" />
          </svg>
        </span>
      </span>
    </div>
  );
}
