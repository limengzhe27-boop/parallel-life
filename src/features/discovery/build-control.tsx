'use client';
import { useEffect, useRef, useState } from 'react';
import type { WorldBuild } from '../../contracts/world-build.ts';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
export function BuildControl({
  seedId,
  build,
  client,
  onChange,
}: {
  seedId: string;
  build?: WorldBuild;
  client: LifeClient;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const command = useRef<string | null>(null),
    retry = useRef<{ taskId: string; commandId: string } | null>(null);
  const task = build?.task,
    waiting = task?.status === 'queued' || task?.status === 'running';

  useEffect(() => {
    if (!waiting || !task?.id) return;
    let live = true;
    void client
      .task(task.id)
      .then(() => {
        if (live) void onChange();
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiFailure ? e.message : '构建未完成，请重试');
      });
  }, [waiting, task?.id, client, onChange]);

  async function act(kind: 'create' | 'retry' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      if (kind === 'create') {
        command.current ??= crypto.randomUUID();
        const worldBuild = await client.createWorld({ seedId, commandId: command.current });
        await onChange();
        if (worldBuild.task?.id) {
          void client
            .task(worldBuild.task.id)
            .then(() => onChange())
            .catch((e) => setError(e instanceof ApiFailure ? e.message : '构建未完成，请重试'));
        }
        return;
      } else if (task) {
        if (kind === 'cancel') await client.cancelTask(task.id);
        else {
          if (retry.current?.taskId !== task.id)
            retry.current = { taskId: task.id, commandId: crypto.randomUUID() };
          await client.retryTask(task.id, retry.current.commandId);
          void client
            .task(task.id)
            .then(() => onChange())
            .catch((e) => setError(e instanceof ApiFailure ? e.message : '构建未完成，请重试'));
        }
      }
      await onChange();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : '暂时没有完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="build-control">
      {build?.ready ? (
        <>
          <div className="build-state build-state-ready" role="status">
            <span className="build-state-dot" aria-hidden="true" />
            <span>
              <strong>这段人生已经准备好</strong>
              <small>从锁屏开始你的新日常</small>
            </span>
          </div>
          <a className="button primary" href={`/worlds/${build.worldId}`}>
            打开手机
            <span aria-hidden="true">→</span>
          </a>
        </>
      ) : waiting ? (
        <>
          <div className="build-state" role="status">
            <span className="build-state-spinner" aria-hidden="true" />
            <span>
              <strong>{task.status === 'queued' ? '已排队' : '正在准备你的世界'}</strong>
              <small>身份、人物和开场会先出现</small>
            </span>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            暂停
          </Button>
        </>
      ) : task ? (
        <>
          <div className="build-state build-state-error" role="status">
            <span className="build-state-dot" aria-hidden="true" />
            <span>
              <strong>
                {task.status === 'unknown'
                  ? '还没有收到完整结果'
                  : task.status === 'cancelled'
                    ? '创建已暂停'
                    : '这次没有完成'}
              </strong>
              <small>你的设定还在，可以重新准备</small>
            </span>
          </div>
          <Button disabled={busy} onClick={() => void act('retry')}>
            {busy ? '正在重试…' : '重新准备'}
          </Button>
        </>
      ) : (
        <>
          <div className="build-state">
            <span className="build-state-dot" aria-hidden="true" />
            <span>
              <strong>设定已保存</strong>
              <small>下一步，准备身份、人物和开场</small>
            </span>
          </div>
          <Button disabled={busy} onClick={() => void act('create')}>
            {busy ? '正在提交…' : '开始准备'}
            <span aria-hidden="true">→</span>
          </Button>
        </>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
