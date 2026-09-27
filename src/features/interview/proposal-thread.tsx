'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Discovery, LifeDirection } from '../../contracts/discovery.ts';
import type { WorldBuild } from '../../contracts/world-build.ts';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import { Button, Icon, Modal } from '../../components/ui.tsx';
import { branchEntryState } from './branch-entry.ts';
import { buildBranchBrief } from './branch-intent.ts';

import { SeedConsent } from '../discovery/seed-consent.tsx';
import type { Profile } from '../../contracts/api.ts';
import type { ApprovedSeed } from '../../contracts/seeds.ts';

type Stage = 'idle' | 'discovering' | 'saving' | 'building' | 'entering';

/** 说清楚"为什么现在不能生成分支"，而不是一句"这次没有完成"。 */
function branchFailureMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'INVALID_INPUT')
    return '我还没了解够你的经历——再说两句你在意的选择或难处，我就能推演出属于你的分支。';
  if (code === 'VERSION_CONFLICT') return '资料刚更新过，我按最新内容再试一次就好。';
  if (error instanceof ApiFailure) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '这次没有完成，可以再试一次。';
}

const STAGE_TEXT: Record<Exclude<Stage, 'idle' | 'entering'>, string> = {
  discovering: '正在从你聊到的经历里梳理出真正不同的方向…',
  saving: '正在记下这段人生的起点快照…',
  building: '正在构筑平行世界：准备人物和开场消息…',
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
  const [consent, setConsent] = useState<{
    profile: Profile;
    discovery: Discovery;
    direction: LifeDirection;
  } | null>(null);
  const [approvedSeed, setApprovedSeed] = useState<ApprovedSeed | null>(null);
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

  // 监听对白指令：创建新分支 / 只推荐看看 / 进入已有分支
  useEffect(() => {
    if (!externalTrigger) return;
    void (async () => {
      if (externalIntent === 'create') {
        await handleCreateFromConversation();
        return;
      }
      if (externalIntent === 'recommend') {
        if (directions.length > 0) {
          setConfirmOpen(true);
          return;
        }
        if (entry.kind === 'create') {
          await discoverBranch();
          return;
        }
        if (readyBuild) window.location.assign(`/worlds/${readyBuild.worldId}`);
        return;
      }
      if (readyBuild) {
        window.location.assign(`/worlds/${readyBuild.worldId}`);
        return;
      }
      if (directions.length > 0) {
        setConfirmOpen(true);
        return;
      }
      if (entry.kind === 'create') await discoverBranch();
    })();
  }, [externalTrigger]);

  async function discoverBranch(briefOverride?: string) {
    setError('');
    setStage('discovering');
    try {
      /*
       * 这里曾经同时踩两个坑，导致"聊着聊着说建分支"根本不生效：
       * ① 用父组件传入的 profileVersion（聊天每说一句画像版本都会变）→ 服务端 VERSION_CONFLICT；
       * ② brief 传空字符串 → 没有"已确认事实"时服务端直接 INVALID_INPUT。
       * 现在：每次请求前重新读最新画像版本，并用**用户自己在对话里说过的话**作为 brief。
       */
      const latest = await client.workspace();
      const brief = briefOverride ?? buildBranchBrief(latest.interview.messages);
      const attempt = async (freshProfileVersion: number) => {
        const before = await client.discovery();
        const task = await client.discover({
          commandId: crypto.randomUUID(),
          expectedVersion: before.version,
          expectedProfileVersion: freshProfileVersion,
          brief,
          basedOnId: null,
        });
        const settled = task?.id ? await client.task(task.id) : null;
        if (settled && settled.status !== 'succeeded') throw new Error(taskFailure(settled));
        return client.discovery();
      };
      let fresh;
      try {
        fresh = await attempt(latest.profile.version);
      } catch (e) {
        /* 聊天还在继续时画像会再次变化：用最新版本自动重试一次，而不是直接失败。 */
        const code = (e as { code?: string })?.code;
        const retryable =
          e instanceof ApiFailure &&
          (code === 'VERSION_CONFLICT' || /版本|冲突|重试/.test(e.message));
        if (!retryable) throw e;
        fresh = await attempt((await client.workspace()).profile.version);
      }
      setData(fresh);
      setSelectedIndex(0);
      setStage('idle');
      return { directions: fresh.directions ?? [], version: fresh.version };
    } catch (e) {
      setStage('idle');
      setError(branchFailureMessage(e));
      return { directions: [], version: 0 };
    }
  }

  async function prepareConsent(target: LifeDirection) {
    setError('');
    try {
      const [workspace, discovery] = await Promise.all([client.workspace(), client.discovery()]);
      // Never substitute a changed proposal underneath the user's selection.
      if (discovery.version !== data?.version) {
        setData(discovery);
        setConfirmOpen(false);
        setError('分支方向有更新，请重新查看后选择。');
        return;
      }
      setConsent({ profile: workspace.profile, discovery, direction: target });
      setConfirmOpen(false);
    } catch (e) {
      setError(branchFailureMessage(e));
    }
  }

  async function buildApprovedSeed(seed: ApprovedSeed) {
    setApprovedSeed(seed);
    setError('');
    try {
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

  async function handleCreateFromConversation() {
    setApprovedSeed(null);
    setError('');
    try {
      const workspace = await client.workspace();
      const brief = buildBranchBrief(workspace.interview.messages);
      const fresh = await discoverBranch(brief);
      if (fresh.directions.length) setConfirmOpen(true);
    } catch (e) {
      setError(branchFailureMessage(e));
      setStage('idle');
    }
  }

  function handleOpenReadyWorld() {
    if (!readyBuild) return;
    setStage('entering');
    window.location.assign(`/worlds/${readyBuild.worldId}`);
  }

  // 当处于闲置状态（没有在创建、推演、报错），且用户本次并没有通过对话或操作触发分支意图时，
  // 不在每一轮对话回复下方展示分支选择卡片，保持正常对话界面清爽纯净
  if (stage === 'idle' && !error && externalIntent === 'none') return null;
  if (entry.kind === 'hidden') return null;

  return (
    <section className="proposal-thread" aria-label="对话中的人生分支">
      <div className="proposal-thread-label">
        <Icon name="spark" size={17} />
        <span>你的另一种可能 · 平行分支</span>
      </div>

      {stage !== 'idle' ? (
        <div className="proposal-invitation" style={{ padding: '24px 20px', textAlign: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              marginBottom: 10,
            }}
          >
            <span className="spinner" style={{ width: 20, height: 20 }} />
            <span style={{ fontWeight: 600, fontSize: '16px', color: '#1e293b' }}>
              {stage === 'entering' ? '正在进入全新平行世界…' : STAGE_TEXT[stage]}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            系统正在根据你刚才聊到的想法推演并构筑全新世界分支，请稍候片刻…
          </p>
        </div>
      ) : error ? (
        <div className="proposal-invitation">
          <p role="alert">{error}</p>
          {approvedSeed ? (
            <a className="button secondary" href="/possibilities">
              查看创建进度
            </a>
          ) : (
            <Button variant="secondary" onClick={() => void handleCreateFromConversation()}>
              <Icon name="refresh" size={16} />
              重新整理方向
            </Button>
          )}
        </div>
      ) : entry.kind === 'open-ready' && !directions.length ? (
        <div className="proposal-invitation">
          <p>你可以根据刚才的对话构筑一个全新的人生分支；也可以进入已有的平行世界继续体验。</p>
          <div
            className="proposal-actions"
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}
          >
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void handleCreateFromConversation()}
            >
              ✨ 从当前对话构筑全新分支
              <Icon name="spark" size={16} />
            </Button>
            {readyBuild && (
              <Button variant="secondary" disabled={busy} onClick={handleOpenReadyWorld}>
                📱 进入已有平行世界
                <Icon name="arrow" size={16} />
              </Button>
            )}
          </div>
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

              <div
                className="proposal-actions"
                style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
              >
                <Button variant="primary" disabled={busy} onClick={() => setConfirmOpen(true)}>
                  {busy
                    ? STAGE_TEXT[stage as keyof typeof STAGE_TEXT] || '处理中…'
                    : '开启体验此分支'}
                  {!busy && <Icon name="arrow" size={16} />}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void handleCreateFromConversation()}
                >
                  <Icon name="spark" size={15} />
                  从最新对话生成新分支
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void discoverBranch()}>
                  <Icon name="refresh" size={15} />
                  换个分支聊聊
                </Button>
                {readyBuild && (
                  <Button variant="ghost" disabled={busy} onClick={handleOpenReadyWorld}>
                    📱 返回已有手机
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="proposal-invitation">
              <p>
                向导已记录下你的关键经历。想看看在重要分岔点做出另一种选择，平行世界的你正在过着怎样的生活吗？
              </p>
              <div
                className="proposal-actions"
                style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}
              >
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void handleCreateFromConversation()}
                >
                  ✨ 从当前对话构筑全新分支
                  <Icon name="spark" size={16} />
                </Button>
                {readyBuild && (
                  <Button variant="secondary" disabled={busy} onClick={handleOpenReadyWorld}>
                    📱 进入已有平行世界
                  </Button>
                )}
              </div>
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
          title="看看这条人生"
        >
          <div className="proposal-confirm-modal">
            <div className="proposal-confirm-box">
              {directions.length > 1 && (
                <label className="form-label">
                  选择方向
                  <select
                    className="field"
                    aria-label="选择人生方向"
                    value={selectedIndex}
                    onChange={(event) => setSelectedIndex(Number(event.target.value))}
                  >
                    {directions.map((direction, index) => (
                      <option key={direction.id} value={index}>
                        {direction.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <h4>《{currentDirection.title}》</h4>
              <p>
                <strong>抉择起点：</strong>
                {currentDirection.premise}
              </p>
              <p>{currentDirection.opening}</p>
              <p>{currentDirection.tradeoff}</p>
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
                  <span>2. 准备人物和开场消息</span>
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
                <Button variant="primary" onClick={() => void prepareConsent(currentDirection)}>
                  选择带入资料
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
      {consent && (
        <SeedConsent
          client={client}
          {...consent}
          onClose={() => setConsent(null)}
          onSaved={(seed) => void buildApprovedSeed(seed)}
        />
      )}
    </section>
  );
}
