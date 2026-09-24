'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Discovery, LifeDirection } from '../../contracts/discovery.ts';
import type { WorldBuild } from '../../contracts/world-build.ts';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import { Button, Icon, Modal } from '../../components/ui.tsx';
import { branchEntryState } from './branch-entry.ts';

type Stage = 'idle' | 'discovering' | 'saving' | 'building' | 'entering';

const STAGE_TEXT: Record<Exclude<Stage, 'idle' | 'entering'>, string> = {
  discovering: '正在从你聊到的经历里梳理出真正不同的方向…',
  saving: '正在记下这段人生的起点快照…',
  building: '正在构筑平行世界：生成微信好友、群聊与开场剧情…',
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
  externalTrigger,
  externalIntent = 'none',
}: {
  client: LifeClient;
  revision: number;
  ready: boolean;
  profileVersion: number;
  confirmedCount: number;
  pendingCandidates: number;
  externalTrigger?: number;
  /** 'create' builds a branch for the user, 'recommend' only shows what exists. */
  externalIntent?: 'create' | 'recommend' | 'enter' | 'none';
}) {
  const [data, setData] = useState<Discovery | null>(null),
    [builds, setBuilds] = useState<WorldBuild[]>([]),
    [stage, setStage] = useState<Stage>('idle'),
    [error, setError] = useState(''),
    [selectedIndex, setSelectedIndex] = useState(0),
    [confirmOpen, setConfirmOpen] = useState(false);
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

  const currentDirection: LifeDirection | undefined = directions[selectedIndex] ?? directions[0];

  // 监听对白指令：进入已有分支 / 推荐看看 / 直接创建一个并进入
  useEffect(() => {
    if (!externalTrigger) return;
    void (async () => {
      if (readyBuild) {
        window.location.assign(`/worlds/${readyBuild.worldId}`);
        return;
      }
      if (externalIntent === 'create') {
        /* The user explicitly asked for a branch, so build the first direction and enter. */
        const available = directions.length > 0 ? directions : await discoverBranch();
        const target = available[selectedIndex] ?? available[0];
        if (target) await confirmAndBuild(target);
        return;
      }
      if (directions.length > 0) {
        setConfirmOpen(true);
        return;
      }
      if (entry.kind === 'create') await discoverBranch();
    })();
  }, [externalTrigger]);

  async function discoverBranch() {
    setError('');
    setStage('discovering');
    try {
      let currentDisc = await client.discovery();
      const task = await client.discover({
        commandId: crypto.randomUUID(),
        expectedVersion: currentDisc.version,
        expectedProfileVersion: profileVersion,
        brief: '',
        basedOnId: null,
      });
      const settled = task?.id ? await client.task(task.id) : null;
      if (settled && settled.status !== 'succeeded') throw new Error(taskFailure(settled));
      currentDisc = await client.discovery();
      setData(currentDisc);
      setSelectedIndex(0);
      setStage('idle');
      return currentDisc.directions ?? [];
    } catch (e) {
      setStage('idle');
      setError(
        e instanceof ApiFailure
          ? e.message
          : e instanceof Error && e.message
            ? e.message
            : '这次没有完成，可以再试一次。',
      );
      return [];
    }
  }

  async function confirmAndBuild(target: LifeDirection) {
    setError('');
    try {
      setStage('saving');
      const latestProfile = (await client.workspace()).profile;
      const available = new Set(
        latestProfile.facts.filter((f) => f.status === 'confirmed').map((f) => f.id),
      );
      const hasPortrait = Boolean(latestProfile.portraitAssetId);
      const seed = await client.approveSeed({
        commandId: crypto.randomUUID(),
        discoveryVersion: data?.version ?? 0,
        profileVersion: latestProfile.version,
        directionId: target.id,
        factIds: (target.sources ?? []).map((s) => s.factId).filter((id) => available.has(id)),
        personIds: [],
        includePortrait: hasPortrait,
      });

      setStage('building');
      const build = await client.createWorld({ commandId: crypto.randomUUID(), seedId: seed.id });
      if (build.task?.id) {
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

  function handleOpenReadyWorld() {
    if (!readyBuild) return;
    setStage('entering');
    window.location.assign(`/worlds/${readyBuild.worldId}`);
  }

  if (entry.kind === 'hidden') return null;

  return (
    <section className="proposal-thread" aria-label="对话中的人生分支">
      <div className="proposal-thread-label">
        <Icon name="spark" size={17} />
        <span>你的另一种可能 · 平行分支</span>
      </div>

      {entry.kind === 'open-ready' ? (
        <div className="proposal-invitation">
          <p>这段人生已经生成好了，可以随时进入手机开始体验。</p>
          <Button variant="primary" disabled={busy} onClick={handleOpenReadyWorld}>
            {stage === 'entering' ? '正在打开手机…' : '打开我的平行手机'}
            <Icon name="arrow" size={16} />
          </Button>
        </div>
      ) : entry.kind === 'confirm-records' ? (
        <div className="proposal-invitation">
          <p>
            还有 {entry.pending}{' '}
            条记录等你确认。分支方向必须来自你确认过的真实经历，确认后向导就能为你聊出属于你的分支。
          </p>
          <a className="button secondary" href="#profile">
            去确认这些记录
            <Icon name="chevron" size={16} />
          </a>
        </div>
      ) : entry.kind === 'needs-material' ? (
        <div className="proposal-invitation">
          <p>先多聊几句你的关键抉择与经历。有真实的锚点时，向导才能为你找出真正不同的平行分支。</p>
        </div>
      ) : (
        <>
          {directions.length > 0 && currentDirection ? (
            <div className="proposal-featured-card">
              <div className="proposal-branch-header">
                <span className="proposal-branch-badge">
                  <Icon name="spark" size={13} />
                  聊出的平行分支 · {selectedIndex + 1}/{directions.length}
                </span>
                {directions.length > 1 && (
                  <div className="proposal-branch-nav" aria-label="切换分支">
                    <button
                      type="button"
                      disabled={selectedIndex === 0}
                      onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                    >
                      上一分支
                    </button>
                    <button
                      type="button"
                      disabled={selectedIndex === directions.length - 1}
                      onClick={() =>
                        setSelectedIndex((i) => Math.min(directions.length - 1, i + 1))
                      }
                    >
                      下一分支
                    </button>
                  </div>
                )}
              </div>

              <h3 className="proposal-branch-title">{currentDirection.title}</h3>

              <div className="proposal-meta-row">
                <span className="proposal-meta-label">如果·分岔抉择</span>
                <p className="proposal-meta-text">{currentDirection.premise}</p>
              </div>

              <div className="proposal-meta-row">
                <span className="proposal-meta-label">平行现状透视</span>
                <p className="proposal-meta-text">{currentDirection.opening}</p>
              </div>

              {currentDirection.tradeoff && (
                <div className="proposal-meta-row">
                  <span className="proposal-meta-label">心境与代价</span>
                  <p className="proposal-meta-text">{currentDirection.tradeoff}</p>
                </div>
              )}

              <div className="proposal-actions">
                <Button variant="primary" disabled={busy} onClick={() => setConfirmOpen(true)}>
                  {busy
                    ? STAGE_TEXT[stage as keyof typeof STAGE_TEXT] || '处理中…'
                    : '开启体验此分支'}
                  {!busy && <Icon name="arrow" size={16} />}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void discoverBranch()}>
                  <Icon name="refresh" size={15} />
                  换个分支聊聊
                </Button>
              </div>
            </div>
          ) : (
            <div className="proposal-invitation">
              <p>
                向导已记录下你的关键经历。想看看在重要分岔点做出另一种选择，平行世界的你正在过着怎样的生活吗？
              </p>
              <Button variant="primary" disabled={busy} onClick={() => void discoverBranch()}>
                {stage === 'discovering' ? STAGE_TEXT.discovering : '根据聊天，推演我的平行分支'}
                {!busy && <Icon name="spark" size={16} />}
              </Button>
            </div>
          )}

          {error && (
            <div className="proposal-invitation">
              <p role="alert">{error}</p>
              <Button variant="secondary" onClick={() => void discoverBranch()}>
                <Icon name="refresh" size={16} />
                重试
              </Button>
            </div>
          )}
        </>
      )}

      {/* 确认创建并进入体验的模态弹窗：必须经过用户确认后才创建世界 */}
      {currentDirection && (
        <Modal
          open={confirmOpen}
          onClose={() => {
            if (!busy) setConfirmOpen(false);
          }}
          title="确认开启平行分支体验"
        >
          <div className="proposal-confirm-modal">
            <div className="proposal-confirm-box">
              <h4>《{currentDirection.title}》</h4>
              <p>
                <strong>抉择起点：</strong>
                {currentDirection.premise}
              </p>
              <p>
                即将根据该分支为你创造属于你的平行世界，构筑平行手机、微信关系网与第一批未读消息。
              </p>
            </div>

            {busy ? (
              <div className="proposal-step-flow">
                <div className={`proposal-step-item ${stage === 'saving' ? 'active' : ''}`}>
                  <span>1. 固化人生起点快照</span>
                  {stage === 'saving' && (
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                  )}
                </div>
                <div className={`proposal-step-item ${stage === 'building' ? 'active' : ''}`}>
                  <span>2. 构筑微信关系网与图生图身份写真 (约需 30~45s)</span>
                  {stage === 'building' && (
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                  )}
                </div>
                <div className={`proposal-step-item ${stage === 'entering' ? 'active' : ''}`}>
                  <span>3. 构筑完成，正在为你点亮平行手机...</span>
                  {stage === 'entering' && (
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                  )}
                </div>
              </div>
            ) : (
              <div className="proposal-actions">
                <Button variant="primary" onClick={() => void confirmAndBuild(currentDirection)}>
                  确认创建，打开平行手机
                  <Icon name="arrow" size={16} />
                </Button>
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                  我再想想
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
