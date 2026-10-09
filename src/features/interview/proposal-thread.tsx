'use client';
import { useEffect, useRef, useState } from 'react';
import type { Discovery, DiscoverRequest, LifeDirection } from '../../contracts/discovery.ts';
import type { WorldBuild } from '../../contracts/world-build.ts';
import type { LifeDraft } from '../../contracts/life-drafts.ts';
import type { Profile } from '../../contracts/api.ts';
import { ApiFailure, type LifeClient } from '../api/client.ts';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { branchMaterialBrief } from './branch-entry.ts';
import { DraftEditor } from '../discovery/draft-editor.tsx';
import s from './proposal-thread.module.css';

type Stage = 'idle' | 'discovering' | 'building' | 'entering';
const pendingStatus = (status?: string) => status === 'queued' || status === 'running';
function explain(error: unknown) {
  return error instanceof ApiFailure || error instanceof Error
    ? error.message
    : '暂时没有完成，原来的方向仍保留。';
}
function failure(status: string) {
  return status === 'unknown'
    ? '这次结果未知，可能已产生费用。不会自动重新生成，请先查看进度。'
    : status === 'conflict'
      ? '资料已有更新，请按最新内容重新构思。'
      : status === 'cancelled'
        ? '构思已暂停，之前的内容仍保留。'
        : '这次没有完整返回，之前的内容仍保留。';
}
export function ProposalThread({
  client,
  revision,
  ready,
  messages,
  externalTrigger,
  externalIntent = 'none',
}: {
  client: LifeClient;
  revision: number;
  ready: boolean;
  profileVersion: number;
  confirmedCount: number;
  pendingCandidates: number;
  messages: readonly { role: string; text: string; photoAssetId?: string | null }[];
  externalTrigger?: number;
  externalIntent?: 'create' | 'recommend' | 'enter' | 'none';
}) {
  const [data, setData] = useState<Discovery | null>(null),
    [builds, setBuilds] = useState<WorldBuild[]>([]),
    [stage, setStage] = useState<Stage>('idle'),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [selectedIndex, setSelectedIndex] = useState(0),
    [approvedSeed, setApprovedSeed] = useState<string | null>(null),
    [consent, setConsent] = useState<{ profile: Profile; draft: LifeDraft } | null>(null);
  const pending = useRef<DiscoverRequest | null>(null),
    actionLock = useRef(false);
  const readyBuild = builds.find((b) => b.ready),
    unresolvedBuild = builds.find((b) => !b.ready && b.task && b.task.status !== 'succeeded');
  const task = data?.activeTask,
    waiting = pendingStatus(task?.status),
    busy = stage !== 'idle' || waiting;
  const recoverable = task && ['unknown', 'failed', 'conflict', 'cancelled'].includes(task.status);
  const directions = data?.directions ?? [],
    direction = directions[selectedIndex] ?? directions[0];
  const material = branchMaterialBrief(messages);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const read = async () => {
      try {
        const [d, b] = await Promise.all([client.discovery(), client.builds()]);
        if (live) {
          setData((current) => (!current || d.version >= current.version ? d : current));
          setBuilds(b);
        }
      } catch {
        if (live) setError('暂时未能读取构思进度，请打开分支页核对。');
      }
    };
    void read();
    // Read-only recovery: opening this entry never resubmits unknown or starts a paid task.
    const timer =
      waiting || pendingStatus(unresolvedBuild?.task?.status)
        ? setInterval(() => void read(), 2500)
        : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [client, revision, ready, waiting, unresolvedBuild?.task?.status]);

  useEffect(() => {
    if (externalTrigger && externalIntent === 'enter' && readyBuild)
      window.location.assign(`/worlds/${readyBuild.worldId}`);
    // Other conversational intents expose only the shortcut. A user click opens details or generates.
  }, [externalTrigger]);

  async function discover(mode: 'focused' | 'explore') {
    if (actionLock.current || busy || unresolvedBuild) return;
    actionLock.current = true;
    setOpen(true);
    setError('');
    setStage('discovering');
    try {
      const [workspace, before] = await Promise.all([client.workspace(), client.discovery()]);
      if (before.activeTask && pendingStatus(before.activeTask.status)) {
        setData(before);
        return;
      }
      const brief = branchMaterialBrief(workspace.interview.messages);
      if (!brief && !workspace.profile.facts.some((f) => f.status === 'confirmed'))
        throw new Error('先聊聊你想体验的生活或选择，再来构思。');
      const fields = {
        expectedVersion: before.version,
        expectedProfileVersion: workspace.profile.version,
        brief,
        basedOnId: null,
        mode,
      };
      if (
        !pending.current ||
        JSON.stringify({ ...pending.current, commandId: undefined }) !== JSON.stringify(fields)
      )
        pending.current = { ...fields, commandId: crypto.randomUUID() };
      const started = await client.discover(pending.current);
      pending.current = null;
      setData({ ...before, activeTask: started });
      const settled = await client.task(started.id);
      const latest = await client.discovery();
      setData(latest);
      setSelectedIndex(0);
      if (settled.status !== 'succeeded') setError(failure(settled.status));
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') pending.current = null;
      setError(explain(e));
    } finally {
      setStage('idle');
      actionLock.current = false;
    }
  }
  async function prepare(target: LifeDirection) {
    if (actionLock.current || busy) return;
    actionLock.current = true;
    setError('');
    try {
      const [workspace, latest] = await Promise.all([client.workspace(), client.discovery()]);
      if (latest.version !== data?.version) {
        setData(latest);
        throw new Error('方向刚有更新，请重新查看后选择。');
      }
      const draft = await client.prepareDraft({
        commandId: crypto.randomUUID(),
        directionId: target.id,
        discoveryVersion: latest.version,
      });
      setOpen(false);
      setConsent({ profile: workspace.profile, draft });
    } catch (e) {
      setError(explain(e));
    } finally {
      actionLock.current = false;
    }
  }
  async function build(draft: LifeDraft) {
    if (!draft.seedId || actionLock.current) return;
    actionLock.current = true;
    setConsent(null);
    setApprovedSeed(draft.seedId);
    setError('');
    setStage('building');
    try {
      const currentBuilds = await client.builds();
      const existing = currentBuilds.find((b) => b.seedId === draft.seedId);
      const next =
        existing ??
        (await client.createWorld({ commandId: crypto.randomUUID(), seedId: draft.seedId }));
      setBuilds((current) => [next, ...current.filter((b) => b.worldId !== next.worldId)]);
      if (next.task?.id) {
        const settled = await client.task(next.task.id);
        if (settled.status !== 'succeeded') throw new Error(failure(settled.status));
      }
      setStage('entering');
      window.location.assign(`/worlds/${next.worldId}`);
    } catch (e) {
      setStage('idle');
      setError(explain(e));
    } finally {
      actionLock.current = false;
    }
  }
  if (!ready && !busy && !error) return null;
  const status =
    stage === 'building'
      ? '正在准备手机'
      : stage === 'entering'
        ? '正在进入人生'
        : busy
          ? '正在构思'
          : recoverable || unresolvedBuild || approvedSeed || error
            ? '查看进度'
            : directions.length
              ? '查看构思'
              : '构思人生';
  return (
    <>
      <section className={s.shortcut} aria-label="人生构思快捷入口">
        <Button variant="ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <Icon name="spark" size={16} />
          {status}
          <Icon name="chevron" size={15} />
        </Button>
        {(busy || recoverable || unresolvedBuild || error) && (
          <span role="status">{busy ? '可以继续聊天' : '内容仍保留'}</span>
        )}
      </section>
      <Modal open={open} title="这段人生的构思" className={s.dialog} onClose={() => setOpen(false)}>
        <div className={s.content}>
          {busy && (
            <p role="status">
              {status}，可以关闭这里继续聊天。<a href="/possibilities">查看进度</a>
            </p>
          )}
          {(error || recoverable) && (
            <Notice>
              {error || failure(task!.status)}
              <a href="/possibilities">核对进度与恢复</a>
            </Notice>
          )}
          {(unresolvedBuild || approvedSeed) && (
            <a className="button secondary" href="/possibilities">
              查看手机准备进度
            </a>
          )}
          {direction ? (
            <article className={s.direction}>
              {directions.length > 1 && (
                <label>
                  之前的构思
                  <select
                    aria-label="选择已有构思"
                    value={Math.min(selectedIndex, directions.length - 1)}
                    onChange={(e) => setSelectedIndex(Number(e.target.value))}
                  >
                    {directions.map((d, i) => (
                      <option key={d.id} value={i}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <h3>{direction.title}</h3>
              <p>{direction.premise}</p>
              <p>{direction.opening}</p>
              <p className={s.hint}>{direction.tradeoff}</p>
              <Button disabled={busy || !!unresolvedBuild} onClick={() => void prepare(direction)}>
                查看草案
                <Icon name="arrow" size={16} />
              </Button>
            </article>
          ) : (
            <p>
              {material
                ? '沿着刚才聊到的生活，整理一个可修改的起点。'
                : '先聊聊想体验的生活，再在这里构思。'}
            </p>
          )}
          <div className={s.actions}>
            <Button disabled={busy || !!unresolvedBuild} onClick={() => void discover('focused')}>
              {direction ? '从最新对话构思一个起点' : '构思这段人生'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !!unresolvedBuild}
              onClick={() => void discover('explore')}
            >
              探索其他可能
            </Button>
            {readyBuild && (
              <a className="button secondary" href={`/worlds/${readyBuild.worldId}`}>
                返回已有手机
              </a>
            )}
          </div>
          <p className={s.hint}>
            构思当前想法会整理一个方向；只有选择探索其他可能，才会寻找不同方向。确认草案后才准备手机。
          </p>
        </div>
      </Modal>
      {consent && (
        <DraftEditor
          client={client}
          {...consent}
          onClose={() => setConsent(null)}
          onConfirmed={(draft) => void build(draft)}
        />
      )}
    </>
  );
}
