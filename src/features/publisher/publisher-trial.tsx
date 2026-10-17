'use client';
import { useEffect, useMemo, useState } from 'react';
import { PublisherClient } from './publisher-client.ts';
import { WorldPhoneApp } from '../phone/world-phone-app.tsx';
import type { PublicationTrial, TrialDirectorStatus } from '../../contracts/publication-worlds.ts';
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
  const [director, setDirector] = useState<TrialDirectorStatus | null>(null),
    [confirmRetry, setConfirmRetry] = useState(false);
  const [paused, setPaused] = useState<boolean | null>(null),
    [changingLifecycle, setChangingLifecycle] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await client.session();
        const value = await client.trial(trialId);
        const clock = await client.trialClock(trialId);
        const directorState = await client.trialDirector(trialId);
        if (alive) {
          setDirector(directorState);
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
      const current = await client.trialDirector(trial.trialId);
      setDirector(current);
      setStoryNotice(
        current.status === 'failed'
          ? '上次编排没有完成，请核对后重新生成。'
          : value.played
            ? '已推进一条剧情，请在手机里查看新来信。'
            : '当前没有满足条件的事件，不会强行推进。',
      );
      setRefresh((v) => v + 1);
    } catch {
      setStoryNotice('这次剧情结果还需要核对，请先查看手机，避免反复点击。');
    } finally {
      try {
        setDirector(await client.trialDirector(trial.trialId));
      } catch {
        setDirector(null);
      }
      setAdvancing(false);
    }
  }
  async function checkDirector() {
    if (!trial || advancing) return;
    try {
      setDirector(await client.trialDirector(trial.trialId));
    } catch {
      setStoryNotice('暂时无法核对结果，请稍后查看。');
    }
  }
  async function retryDirector() {
    if (
      !trial ||
      advancing ||
      paused !== false ||
      director?.status !== 'failed' ||
      !director.attemptId ||
      !confirmRetry
    )
      return;
    setAdvancing(true);
    setConfirmRetry(false);
    setStoryNotice('');
    try {
      setDirector(await client.retryTrialDirector(trial.trialId, director.attemptId));
      setStoryNotice('已核对编排结果。若暂无新来信，可继续推进，由人物自行决定如何回应。');
      setRefresh((v) => v + 1);
    } catch {
      setStoryNotice('这次重新编排未能确认，请先核对结果，不要反复生成。');
      setDirector(null);
    } finally {
      try {
        setDirector(await client.trialDirector(trial.trialId));
      } catch {
        setDirector(null);
      }
      setAdvancing(false);
    }
  }
  return trial ? (
    <>
      <details
        style={{
          position: 'fixed',
          right: 12,
          bottom: 12,
          zIndex: 1000,
          maxWidth: 'min(280px, calc(100vw - 24px))',
          maxHeight: 'min(60dvh, 420px)',
          overflowY: 'auto',
          padding: 12,
          borderRadius: 12,
          background: '#fff',
          color: '#172033',
          boxShadow: '0 2px 12px #0002',
        }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          {paused ? '试演已暂停 · 点击开始' : '试演控制 · 运行中'}
        </summary>
        {director?.summary ? (
          <div
            role="status"
            style={{
              fontSize: 13,
              fontWeight: 500,
              padding: '6px 10px',
              borderRadius: 8,
              background: '#f1f5f9',
              color: '#0f172a',
              marginTop: 8,
              marginBottom: 6,
            }}
          >
            {director.summary}
          </div>
        ) : null}
        {director?.lastEffectiveChange ? (
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            最近有效变化：{director.lastEffectiveChange}
          </div>
        ) : null}
        <button
          disabled={changingLifecycle || advancing || paused === null}
          onClick={() => void changeLifecycle()}
        >
          {changingLifecycle || paused === null ? '正在核对…' : paused ? '开始试演' : '暂停试演'}
        </button>
        <p style={{ fontSize: 13 }}>先开始试演，再发微信或手动推进；打开页面不会自动演绎。</p>
        <p style={{ fontSize: 13 }}>每次只演绎一个已满足条件的机会，不改写玩家的选择。</p>
        <button
          disabled={advancing || paused !== false || changingLifecycle || !director}
          onClick={() => void advanceStory()}
        >
          {advancing
            ? '正在试演…'
            : director?.status === 'failed'
              ? '推进已有安排'
              : '推进一条剧情'}
        </button>
        {director?.status === 'failed' || director?.actionableRecovery === 'retry' ? (
          <div role="status">
            <p>上次编排未通过检查，没有当作剧情发生。聊天记录仍保留。</p>
            {confirmRetry ? (
              <>
                <p>重新生成会调用模型，并按当前状态重新编排。</p>
                <button
                  disabled={advancing || paused !== false}
                  onClick={() => void retryDirector()}
                >
                  确认重新生成
                </button>
                <button disabled={advancing} onClick={() => setConfirmRetry(false)}>
                  取消
                </button>
              </>
            ) : (
              <button
                disabled={advancing || paused !== false}
                onClick={() => setConfirmRetry(true)}
              >
                重新编排
              </button>
            )}
          </div>
        ) : director && ['unknown', 'pending', 'blocked'].includes(director.status) ? (
          <p role="status">
            {director.status === 'unknown'
              ? '上次调用正在核对结果，不会自动重新生成。'
              : director.status === 'pending'
                ? '上次请求正在处理中…'
                : '世界状态已前进，旧提案已自然过期。'}
          </p>
        ) : null}
        {director?.actionableRecovery === 'check_receipt' || director?.status === 'unknown' ? (
          <button disabled={advancing} onClick={() => void checkDirector()}>
            核对结果
          </button>
        ) : null}
        {storyNotice ? <p role="status">{storyNotice}</p> : null}
      </details>
      <WorldPhoneApp
        key={trial.worldId + ':' + refresh}
        worldId={trial.worldId}
        transport={transport}
        automatic={false}
        wechatActorKey={wechatActorKey}
        mediaUrlFor={(_worldId, assetId) =>
          `/api/v1/publisher/trials/${encodeURIComponent(trial.trialId)}/world/media/${encodeURIComponent(assetId)}`
        }
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
