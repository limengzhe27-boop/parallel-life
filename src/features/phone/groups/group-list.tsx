import type { PhoneContact } from '../apps/types.ts';
import { formatChatTime, searchable } from '../apps/helpers.ts';
import { activeMembers, groupPreview, isJoined } from './state.ts';
import type { GroupsController } from './use-groups.ts';
import s from './groups.module.css';
export function GroupAvatar({ names }: { names: string[] }) {
  return (
    <span className={s.avatar} aria-hidden>
      {names.slice(0, 4).map((name, i) => (
        <span key={i}>{name.slice(0, 1)}</span>
      ))}
    </span>
  );
}
export function GroupListRows({
  groups,
  contacts,
  query,
  open,
}: {
  groups: GroupsController;
  contacts: readonly PhoneContact[];
  query: string;
  open: (id: string) => void;
}) {
  if (!groups.enabled) return null;
  const rows = (groups.list?.groups ?? [])
    .map((g) => groups.details[g.id]?.group ?? g)
    .filter((g) => searchable(query, g.title))
    .sort((a, b) => {
      const last = (id: string) => {
        const d = groups.details[id],
          m = d?.messages.at(-1);
        return m ? Date.parse(d!.messageTimes[m.id]?.storyAt ?? '') : 0;
      };
      return last(b.id) - last(a.id);
    });
  return (
    <section aria-label="群聊">
      {groups.loading && !groups.list && (
        <p className={s.hint} role="status">
          正在查看群聊…
        </p>
      )}
      {groups.error && (
        <div className={s.notice} role="alert">
          {groups.error} <button onClick={() => void groups.refresh()}>刷新群聊</button>
        </div>
      )}
      {rows.map((group) => {
        const detail = groups.details[group.id],
          last = detail?.messages.at(-1);
        const names = activeMembers(group).map((p) =>
          p.kind === 'player' ? '我' : (contacts.find((c) => c.id === p.actorId)?.name ?? '群成员'),
        );
        return (
          <button className={s.row} key={group.id} onClick={() => open(group.id)}>
            <span className={s.avatarWrap}>
              <GroupAvatar names={names} />
              {Boolean(detail?.unread) && (
                <span className={s.badge}>{detail!.unread > 99 ? '99+' : detail!.unread}</span>
              )}
            </span>
            <span className={s.rowBody}>
              <span className={s.rowTitle}>
                <strong>{group.title}</strong>
                <span>群聊{!isJoined(group) ? ' · 已退出' : ''}</span>
              </span>
              <span className={s.preview}>
                {detail ? groupPreview(detail, contacts) : '点击查看消息'}
              </span>
            </span>
            {last && (
              <time className={s.rowTime}>
                {formatChatTime(detail!.messageTimes[last.id]?.storyAt ?? '', groups.list?.storyAt)}
              </time>
            )}
          </button>
        );
      })}
    </section>
  );
}
