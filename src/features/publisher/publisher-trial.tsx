'use client';
import { useEffect, useMemo, useState } from 'react';
import { PublisherClient } from './publisher-client.ts';
import { WorldPhoneApp } from '../phone/world-phone-app.tsx';
import type { PublicationTrial } from '../../contracts/publication-worlds.ts';
export function PublisherTrial({
  trialId,
  wechatActorKey,
}: {
  trialId: string;
  wechatActorKey?: string;
}) {
  const [client] = useState(() => new PublisherClient()),
    [trial, setTrial] = useState<PublicationTrial | null>(null),
    [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0),
    [advancing, setAdvancing] = useState(false),
    [storyNotice, setStoryNotice] = useState('');
  const [paused, setPaused] = useState<boolean | null>(null),
    [changingLifecycle, setChangingLifecycle] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await client.session();
        const value = await client.trial(trialId);
        const clock = await client.trialClock(trialId);
        if (alive) {
          setTrial(value);
          setPaused(clock.paused);
        }
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
  async function changeLifecycle() {
    if (!trial || paused === null || changingLifecycle) return;
    setChangingLifecycle(true);
    setStoryNotice('');
    try {
      const result = await client.setTrialPaused(trial.trialId, !paused);
      if (result.worldId !== trial.worldId) throw Error('wrong trial');
      setPaused(result.paused);
      setRefresh((v) => v + 1);
    } catch {
      setStoryNotice('这次试演状态没能确认，请重新打开核对。');
    } finally {
      setChangingLifecycle(false);
    }
  }
  async function advanceStory() {
    if (!transport || !trial || advancing) return;
    setAdvancing(true);
    setStoryNotice('');
    try {
      const r = await transport('/api/v1/worlds/' + trial.worldId + '/story/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const value = await r.json();
      if (!r.ok) throw Error('failed');
      setStoryNotice(
        value.played
          ? '已推进一条剧情，请在手机里查看新来信。'
          : '当前没有满足条件的事件，不会强行推进。',
      );
      setRefresh((v) => v + 1);
    } catch {
      setStoryNotice('这次剧情结果还需要核对，请先查看手机，避免反复点击。');
    } finally {
      setAdvancing(false);
    }
  }
  return trial ? (
    <>
      {!wechatActorKey && (
        <details
          style={{
            position: 'fixed',
            right: 12,
            bottom: 12,
            zIndex: 1000,
            maxWidth: 250,
            padding: 12,
            borderRadius: 12,
            background: '#fff',
            color: '#172033',
            boxShadow: '0 2px 12px #0002',
          }}
        >
          <summary>试演剧情</summary>
          <button
            disabled={changingLifecycle || advancing || paused === null}
            onClick={() => void changeLifecycle()}
          >
            {changingLifecycle || paused === null ? '正在核对…' : paused ? '开始试演' : '暂停试演'}
          </button>
          <p style={{ fontSize: 13 }}>
            开始后可使用地图与现场；不会自动调用导演，也不会影响玩家存档。
          </p>
          <p style={{ fontSize: 13 }}>每次只演绎一个已满足条件的机会，不改写玩家的选择。</p>
          <button disabled={advancing} onClick={() => void advanceStory()}>
            {advancing ? '正在试演…' : '推进一条剧情'}
          </button>
          {storyNotice ? <p role="status">{storyNotice}</p> : null}
        </details>
      )}
      <WorldPhoneApp
        key={trial.worldId + ':' + refresh}
        worldId={trial.worldId}
        transport={transport}
        automatic={false}
        wechatActorKey={wechatActorKey}
      />
    </>
  ) : (
    <main style={{ padding: 24, color: '#172033', background: '#fff', minHeight: '100dvh' }}>
      {error || '正在读取已保存草稿的独立试演…'}
      <p>
        <a href="/workbench">返回内容后台</a>
      </p>
    </main>
  );
}
