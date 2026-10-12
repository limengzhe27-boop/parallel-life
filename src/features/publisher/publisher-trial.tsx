'use client';
import { useEffect, useMemo, useState } from 'react';
import { PublisherClient } from './publisher-client.ts';
import { WorldPhoneApp } from '../phone/world-phone-app.tsx';
import type { PublicationTrial } from '../../contracts/publication-worlds.ts';
export function PublisherTrial({ trialId }: { trialId: string }) {
  const [client] = useState(() => new PublisherClient()),
    [trial, setTrial] = useState<PublicationTrial | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await client.session();
        const value = await client.trial(trialId);
        if (alive) setTrial(value);
      } catch {
        if (alive) setError('无法打开这份试演。请回到后台核对登录状态和草稿。');
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, trialId]);
  const transport = useMemo(
    () => (trial ? client.trialTransport(trial.trialId, trial.worldId) : undefined),
    [client, trial],
  );
  return trial ? (
    <WorldPhoneApp
      key={trial.worldId}
      worldId={trial.worldId}
      transport={transport}
      automatic={false}
    />
  ) : (
    <main style={{ padding: 24, color: '#172033', background: '#fff', minHeight: '100dvh' }}>
      {error || '正在读取已保存草稿的独立试演…'}
      <p>
        <a href="/workbench">返回内容后台</a>
      </p>
    </main>
  );
}
