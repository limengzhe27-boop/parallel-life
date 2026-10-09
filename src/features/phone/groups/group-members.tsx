import { useRef, useState } from 'react';
import type { GroupDetail } from './client.ts';
import type { GroupsController } from './use-groups.ts';
import type { PhoneContact } from '../apps/types.ts';
import { activeMembers, isJoined, publicMemberName } from './state.ts';
import s from './groups.module.css';
export function GroupMembers({
  detail,
  groups,
  contacts,
  close,
  updated,
}: {
  detail: GroupDetail;
  groups: GroupsController;
  contacts: readonly PhoneContact[];
  close: () => void;
  updated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [confirm, setConfirm] = useState<string>();
  const command = useRef<{ id: string; version: number; signature: string } | undefined>(undefined);
  const members = activeMembers(detail.group),
    joined = isJoined(detail.group);
  async function change(actorId: string | undefined, action: 'join' | 'leave') {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const fresh = await groups.client.read(groups.worldId, detail.group.id);
      const signature = JSON.stringify([actorId, action]);
      if (command.current?.signature !== signature)
        command.current = { id: crypto.randomUUID(), version: fresh.version, signature };
      await groups.client.membership(groups.worldId, detail.group.id, {
        commandId: command.current!.id,
        expectedVersion: command.current!.version,
        participant: actorId ? { kind: 'actor', actorId } : { kind: 'player' },
        action,
      });
      await updated();
      await groups.refresh();
      void groups.syncWorld();
      setConfirm(undefined);
      command.current = undefined;
    } catch (e) {
      setError(e instanceof Error ? e.message : '没能更新成员，请刷新核对。');
      if (e && typeof e === 'object' && 'code' in e && e.code === 'VERSION_CONFLICT')
        command.current = undefined;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.page} data-phone-fixed-dock>
      <header className={s.header}>
        <button onClick={close}>‹ 返回</button>
        <strong>群聊成员</strong>
        <span className={s.headerSpace} />
      </header>
      <div className={s.scroll}>
        <h2 className={s.groupTitle}>{detail.group.title}</h2>
        <p className={s.hint}>{members.length} 位成员</p>
        {members.map((p, i) => (
          <div className={s.memberRow} key={p.kind === 'player' ? 'player' : p.actorId}>
            <span className={s.personAvatar}>{publicMemberName(p, contacts).slice(0, 1)}</span>
            <strong>{publicMemberName(p, contacts)}</strong>
            {joined && p.kind === 'actor' && (
              <button disabled={busy} onClick={() => setConfirm(p.actorId)}>
                移出
              </button>
            )}
          </div>
        ))}
        {confirm && confirm !== 'self' && (
          <div className={s.notice} role="alert">
            <p>将这位成员移出群聊？</p>
            <button disabled={busy} onClick={() => void change(confirm, 'leave')}>
              确认移出
            </button>
            <button disabled={busy} onClick={() => setConfirm(undefined)}>
              取消
            </button>
          </div>
        )}
        {joined && (
          <>
            <h3 className={s.sectionTitle}>添加成员</h3>
            {contacts
              .filter((c) => !members.some((p) => p.kind === 'actor' && p.actorId === c.id))
              .map((c) => (
                <div className={s.memberRow} key={c.id}>
                  <span className={s.personAvatar}>{c.name.slice(0, 1)}</span>
                  <strong>{c.name}</strong>
                  <button disabled={busy} onClick={() => void change(c.id, 'join')}>
                    加入
                  </button>
                </div>
              ))}
            <p className={s.hint}>新成员只能看到加入之后的消息。</p>
          </>
        )}
        {joined ? (
          <button className={s.leave} disabled={busy} onClick={() => setConfirm('self')}>
            退出群聊
          </button>
        ) : (
          <button
            className={s.primary}
            disabled={busy}
            onClick={() => void change(undefined, 'join')}
          >
            重新加入群聊
          </button>
        )}
        {confirm === 'self' && (
          <div className={s.notice} role="alert">
            <p>退出后不会收到新消息，重新加入也看不到退出期间的内容。</p>
            <button
              className={s.danger}
              disabled={busy}
              onClick={() => void change(undefined, 'leave')}
            >
              确认退出
            </button>
            <button disabled={busy} onClick={() => setConfirm(undefined)}>
              取消
            </button>
          </div>
        )}
        {busy && (
          <p className={s.hint} role="status">
            正在更新成员…
          </p>
        )}
        {error && (
          <p className={s.notice} role="alert">
            {error}
          </p>
        )}
        <p className={s.hint}>群里聊到的安排仍需要在日历中确认。</p>
      </div>
    </div>
  );
}
