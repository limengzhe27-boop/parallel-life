'use client';
import { worldDateTimeLabel } from '../../modules/world/domain/display-time.ts';
import type { useWorldTime } from './use-world-time.ts';
export function TimeExperienceControls({
  time,
  worldVersion,
  reload,
}: {
  time: ReturnType<typeof useWorldTime>;
  worldVersion: number;
  reload: () => Promise<void>;
}) {
  return (
    <details
      style={{
        flexShrink: 0,
        maxWidth: 420,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
        padding: '5px 12px',
        fontSize: 12,
        color: 'var(--muted, #676b65)',
        background: 'var(--surface, #f5f3ed)',
      }}
    >
      <summary style={{ cursor: 'pointer' }}>
        {time.displayTime ? worldDateTimeLabel(time.displayTime) : '正在同步时间…'}
        {' · '}
        {time.clock?.paused
          ? '已暂停 · 点击继续'
          : time.clock?.speed === 1
            ? '交谈中，时间放缓'
            : '日常时间 12 倍'}
      </summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0' }}>
        <button
          disabled={time.working || !time.clock || !!time.pendingWait}
          onClick={() => void (time.clock?.paused ? time.resume() : time.pause())}
        >
          {time.clock?.paused ? '继续这段人生' : '暂停'}
        </button>
        <button
          disabled={time.working || !time.clock || !!time.pendingWait}
          onClick={() => void time.wait('next_appointment', worldVersion, reload)}
        >
          等到赴约前
        </button>
        <button
          disabled={time.working || !time.clock || !!time.pendingWait}
          onClick={() => void time.wait('short', worldVersion, reload)}
        >
          稍等一会
        </button>
        <button
          disabled={time.working || !time.clock || !!time.pendingWait}
          onClick={() => void time.wait('morning', worldVersion, reload)}
        >
          休息到明早
        </button>
        {time.pendingWait && (
          <button
            disabled={time.working}
            onClick={() => void time.wait(time.pendingWait!.target, worldVersion, reload)}
          >
            核对原等待
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 6px', lineHeight: 1.5 }}>
        浏览时加速，交谈时放缓；离开后暂停。等待途中有重要变化，会先停下来。
      </p>
      {time.notice && (
        <p role="status" style={{ margin: '4px 0' }}>
          {time.notice}
        </p>
      )}
      {time.clock?.paused && time.clock.summary && (
        <p role="status" style={{ margin: '4px 0' }}>
          {time.clock.summary}
        </p>
      )}
    </details>
  );
}
