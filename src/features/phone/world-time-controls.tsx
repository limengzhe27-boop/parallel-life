'use client';
import { useState } from 'react';
import type { useWorldTime } from './use-world-time.ts';
import type { LifeClient } from '../api/client.ts';
import { WorldEngineMigrationModal } from './world-engine-migration-modal.tsx';

export function TimeExperienceControls({
  worldId,
  client,
  transport,
  time,
  worldVersion,
  reload,
}: {
  worldId?: string;
  client?: LifeClient;
  transport?: typeof fetch;
  time: ReturnType<typeof useWorldTime>;
  worldVersion: number;
  reload: () => Promise<void>;
}) {
  const [showEngineModal, setShowEngineModal] = useState(false);
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
      <summary style={{ cursor: 'pointer' }}>等待与休息</summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0' }}>
        {time.clock?.paused && time.clock.summary && !time.pendingWait && (
          <button disabled={time.working} onClick={() => void time.continueAtBoundary()}>
            继续体验
          </button>
        )}
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
        {worldId && (
          <button
            type="button"
            onClick={() => setShowEngineModal(true)}
            style={{ fontWeight: 600, color: '#2563eb' }}
          >
            ⚡ 引擎与多A帧管理
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 6px', lineHeight: 1.5 }}>
        进入后自动继续，离开时暂停；浏览时加速，交谈时放缓。等待途中有重要变化，会先停下来。
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
      {showEngineModal && worldId && (
        <WorldEngineMigrationModal
          worldId={worldId}
          client={client}
          transport={transport}
          onClose={() => setShowEngineModal(false)}
          onMigrated={reload}
        />
      )}
    </details>
  );
}
