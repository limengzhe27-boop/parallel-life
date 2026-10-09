import { useState } from 'react';
import type { PhoneContact } from '../apps/types.ts';
import type { GroupsController } from './use-groups.ts';
import s from './groups.module.css';
export function GroupCreate({
  groups,
  contacts,
  close,
  created,
}: {
  groups: GroupsController;
  contacts: readonly PhoneContact[];
  close: () => void;
  created: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [title, setTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [command, setCommand] = useState<{ id: string; version: number; signature: string }>();
  async function submit() {
    if (busy || !selected.length || !title.trim()) return;
    setBusy(true);
    setError(undefined);
    const signature = JSON.stringify([title.trim(), selected]);
    try {
      const current =
        command?.signature === signature
          ? command
          : {
              id: crypto.randomUUID(),
              version: (await groups.client.list(groups.worldId)).version,
              signature,
            };
      setCommand(current);
      const receipt = await groups.client.create(groups.worldId, {
        commandId: current.id,
        expectedVersion: current.version,
        title: title.trim(),
        actorIds: selected,
      });
      await groups.refresh();
      void groups.syncWorld();
      created(receipt.groupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '没能建好群，选择还在。');
      if (e && typeof e === 'object' && 'code' in e && e.code === 'VERSION_CONFLICT')
        setCommand(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.page} data-phone-fixed-dock>
      <header className={s.header}>
        <button onClick={close} disabled={busy}>
          取消
        </button>
        <strong>发起群聊</strong>
        <button
          className={s.confirm}
          onClick={() => void submit()}
          disabled={busy || !selected.length || !title.trim()}
        >
          {busy ? '创建中…' : '创建'}
        </button>
      </header>
      <div className={s.scroll}>
        <label className={s.nameField}>
          群聊名称
          <input
            autoComplete="off"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="给这个群起个名字"
            disabled={busy}
          />
        </label>
        <p className={s.hint}>选择一起聊的人</p>
        {contacts.map((c) => (
          <label key={c.id} className={s.selectRow}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              disabled={busy || (!selected.includes(c.id) && selected.length >= 20)}
              onChange={(e) =>
                setSelected((v) =>
                  e.target.checked ? [...v, c.id] : v.filter((id) => id !== c.id),
                )
              }
            />
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt="" className={s.personAvatar} />
            ) : (
              <span className={s.personAvatar}>{c.name.slice(0, 1)}</span>
            )}
            <span>
              <strong>{c.name}</strong>
              <small>{c.relationship}</small>
            </span>
          </label>
        ))}
        {!contacts.length && <p className={s.hint}>这里还没有可加入群聊的联系人。</p>}
        {error && (
          <p className={s.notice} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
