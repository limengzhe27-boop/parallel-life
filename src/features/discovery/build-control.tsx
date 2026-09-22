'use client';
import { useRef, useState } from 'react';
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
  async function act(kind: 'create' | 'retry' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      if (kind === 'create') {
        command.current ??= crypto.randomUUID();
        await client.createWorld({ seedId, commandId: command.current });
      } else if (task) {
        if (kind === 'cancel') await client.cancelTask(task.id);
        else {
          if (retry.current?.taskId !== task.id)
            retry.current = { taskId: task.id, commandId: crypto.randomUUID() };
          await client.retryTask(task.id, retry.current.commandId);
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
        <a className="button primary" href={`/worlds/${build.worldId}`}>
          进入这段人生 →
        </a>
      ) : waiting ? (
        <>
          <p role="status">
            {task.status === 'queued'
              ? '正在等待构建这段人生…'
              : '正在构建你的身份、身边的人和开场…'}
          </p>
          <Button variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            暂停创建
          </Button>
        </>
      ) : task ? (
        <>
          <p>
            {task.status === 'unknown'
              ? '上次生成结果尚未确认。重试会再次调用模型。'
              : task.status === 'cancelled'
                ? '创建已暂停，设定仍保留。'
                : '这次世界没有生成成功，设定仍保留。'}
          </p>
          <Button disabled={busy} onClick={() => void act('retry')}>
            {busy ? '正在提交…' : '重新创建'}
          </Button>
        </>
      ) : (
        <>
          <p>先生成身份、人物和开场。照片与持续角色对话仍在接入中。</p>
          <Button disabled={busy} onClick={() => void act('create')}>
            {busy ? '正在提交…' : '生成这段人生'}
          </Button>
        </>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
