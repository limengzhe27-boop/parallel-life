'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Discovery } from '../../contracts/discovery.ts';
import type { WorldBuild } from '../../contracts/world-build.ts';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import { Button, Icon } from '../../components/ui.tsx';
import { branchEntryState } from './branch-entry.ts';

type Stage = 'idle' | 'discovering' | 'saving' | 'building' | 'entering';

const STAGE_TEXT: Record<Exclude<Stage, 'idle' | 'entering'>, string> = {
  discovering: '正在从你确认过的经历里找出真正不同的方向…',
  saving: '正在记下这段人生的起点…',
  building: '正在生成身份、人物关系和开场…',
};

function taskFailure(task: { status: string; errorCode?: string | null } | null) {
  const status = task?.status;
  if (status === 'unknown')
    return '这次没有得到完整结果，可能已经产生费用。你可以明确重试，不会自动重复。';
  if (status === 'conflict') return '你的资料在这期间有了更新，请刷新后再试。';
  if (status === 'cancelled') return '这次生成已经取消，可以重新开始。';
  if (task?.errorCode === 'AI_TRUNCATED')
    return '这次生成的内容太长被截断了，没有保存。请再试一次。';
  return '模型这次给出的内容不符合要求，所以没有保存。可以再试一次，或先补充一条资料。';
}

/** A persisted proposal belongs to the personal conversation, not a public feed. */
export function ProposalThread({
  client,
  revision,
  ready,
  profileVersion,
  confirmedCount,
  pendingCandidates,
}: {
  client: LifeClient;
  revision: number;
  ready: boolean;
  profileVersion: number;
  confirmedCount: number;
  pendingCandidates: number;
}) {
  const [data, setData] = useState<Discovery | null>(null),
    [builds, setBuilds] = useState<WorldBuild[]>([]),
    [stage, setStage] = useState<Stage>('idle'),
    [error, setError] = useState('');
  const busy = stage !== 'idle';

  useEffect(() => {
    if (!ready) return;
    let live = true;
    Promise.all([client.discovery(), client.builds()])
      .then(([d, b]) => {
        if (!live) return;
        setData(d);
        setBuilds(b);
      })
      .catch(() => {
        /* A failed read must not block the entry; the action re-reads before it writes. */
      });
    return () => {
      live = false;
    };
  }, [client, revision, ready]);

  const readyBuild = useMemo(() => builds.find((b) => b.ready), [builds]);
  const directions = data?.directions ?? [];
  const entry = branchEntryState({
    ready,
    hasReadyWorld: Boolean(readyBuild),
    confirmedCount,
    pendingCandidates,
    directionCount: directions.length,
  });

  async function enterWorld() {
    setError('');
    try {
      if (readyBuild) {
        setStage('entering');
        window.location.assign(`/worlds/${readyBuild.worldId}`);
        return;
      }
      let currentDisc = await client.discovery();
      if (!currentDisc.directions.length) {
        setStage('discovering');
        const task = await client.discover({
          commandId: crypto.randomUUID(),
          expectedVersion: currentDisc.version,
          expectedProfileVersion: profileVersion,
          brief: '',
          basedOnId: null,
        });
        const settled = task?.id ? await client.task(task.id) : null;
        if (settled && settled.status !== 'succeeded')
          throw new Error(taskFailure(settled));
        currentDisc = await client.discovery();
      }
      const target = currentDisc.directions[0];
      if (!target) throw new Error('模型这次没有给出可用的方向，请再试一次。');

      setStage('saving');
      const latestProfile = (await client.workspace()).profile;
      const available = new Set(
        latestProfile.facts.filter((f) => f.status === 'confirmed').map((f) => f.id),
      );
      const seed = await client.approveSeed({
        commandId: crypto.randomUUID(),
        discoveryVersion: currentDisc.version,
        profileVersion: latestProfile.version,
        directionId: target.id,
        factIds: (target.sources ?? []).map((s) => s.factId).filter((id) => available.has(id)),
        personIds: [],
        includePortrait: false,
      });

      setStage('building');
      const build = await client.createWorld({ commandId: crypto.randomUUID(), seedId: seed.id });
      if (build.task?.id) {
        /* Only continue an attempt that is still queued or running. A failed or
           unknown attempt is reported and retried by the user, never silently. */
        const settled = await client.task(build.task.id);
        if (settled && settled.status !== 'succeeded') throw new Error(taskFailure(settled));
      }
      setStage('entering');
      window.location.assign(`/worlds/${build.worldId}`);
    } catch (e) {
      setStage('idle');
      setError(
        e instanceof ApiFailure
          ? e.message
          : e instanceof Error && e.message
            ? e.message
            : '这次没有完成，可以再试一次。',
      );
    }
  }

  if (entry.kind === 'hidden') return null;

  return (
    <section className="proposal-thread" aria-label="对话中的人生分支">
      <div className="proposal-thread-label">
        <Icon name="spark" size={17} />
        <span>你的另一种可能</span>
      </div>

      {entry.kind === 'open-ready' ? (
        <div className="proposal-invitation">
          <p>这段人生已经生成好了，可以从锁屏开始。</p>
          <Button variant="primary" disabled={busy} onClick={() => void enterWorld()}>
            {stage === 'entering' ? '正在打开手机…' : '打开我的平行手机'}
            <Icon name="arrow" size={16} />
          </Button>
        </div>
      ) : entry.kind === 'confirm-records' ? (
        <div className="proposal-invitation">
          <p>
            还有 {entry.pending} 条记录等你确认。方向必须来自你确认过的经历，确认后就能生成属于你的分支。
          </p>
          <a className="button secondary" href="#profile">
            去确认这些记录
            <Icon name="chevron" size={16} />
          </a>
        </div>
      ) : entry.kind === 'needs-material' ? (
        <div className="proposal-invitation">
          <p>先多聊几句你的经历。有内容可依时，我才能找出真正不同的方向。</p>
        </div>
      ) : (
        <>
          {directions.length > 0 && (
            <>
              {data?.profileVersion !== profileVersion && (
                <p className="proposal-stale">这是此前聊出的想法。你的资料有了变化，可以再调整。</p>
              )}
              {directions.map((d, i) => (
                <a
                  key={d.id}
                  className="proposal-thread-card"
                  href={`/possibilities?direction=${d.id}`}
                >
                  <img
                    src={i === 1 ? '/art/open-door.webp' : '/art/meadow-door.webp'}
                    alt="通用想象插画"
                  />
                  <div>
                    <small>人生方向 · {i + 1}</small>
                    <h3>{d.title}</h3>
                    <span>
                      查看并调整 <Icon name="chevron" size={14} />
                    </span>
                  </div>
                </a>
              ))}
            </>
          )}
          <div className="proposal-actions">
            <Button variant="primary" disabled={busy} onClick={() => void enterWorld()}>
              {busy
                ? stage === 'entering'
                  ? '正在打开手机…'
                  : STAGE_TEXT[stage as keyof typeof STAGE_TEXT]
                : directions.length
                  ? '进入第一个方向 · 打开手机'
                  : '生成我的分支 · 打开手机'}
              {!busy && <Icon name="arrow" size={16} />}
            </Button>
            {directions.length > 0 && (
              <a className="proposal-more" href="/possibilities">
                想换个方向？去分支页微调
              </a>
            )}
          </div>
          {error && (
            <div className="proposal-invitation">
              <p role="alert">{error}</p>
              <Button variant="secondary" onClick={() => void enterWorld()}>
                <Icon name="refresh" size={16} />
                重试
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
