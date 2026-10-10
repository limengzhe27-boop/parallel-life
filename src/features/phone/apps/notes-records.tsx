import type { PlayerRecords } from '../../../contracts/world-records.ts';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { searchable, timeText } from './helpers.ts';
import s from './notes-records.module.css';

type RecordItem = PlayerRecords['current'][number];
type Open = PhoneAppContext['open'];
const attribution: Record<RecordItem['assertion'], string> = {
  player_statement: '你的讲述',
  actor_statement: '人物建议',
  invitation_status: '日程记录',
  starting_context: '人生起点',
};

/** System targets are never private note editor targets, even before a read completes. */
export function isSystemRecordTarget(target?: string): boolean {
  return Boolean(target?.startsWith('sys/'));
}

/** The server supplies the authorized target. Names and message IDs are not contact IDs. */
export function recordDestination(record: RecordItem) {
  const navigation = record.navigation;
  if (navigation?.app === 'wechat') return { app: 'messages' as const, target: navigation.actorId };
  if (navigation?.app === 'calendar')
    return { app: 'calendar' as const, target: navigation.invitationId };
  return undefined;
}

export function searchRecords(records: readonly RecordItem[], query: string): RecordItem[] {
  return records.filter((record) =>
    searchable(query, record.title, record.text, record.stateLabel, attribution[record.assertion]),
  );
}

function RecordRows({ records, open }: { records: readonly RecordItem[]; open: Open }) {
  return (
    <ul className={s.rows}>
      {records.map((record) => (
        <li key={record.id}>
          <button
            type="button"
            className={s.row}
            onClick={() => open('notes', record.id)}
            aria-label={`${record.title}，${record.stateLabel}`}
          >
            <span className={s.rowText}>
              <strong>{record.title}</strong>
              <span className={s.preview}>{record.text}</span>
              <small>{record.stateLabel}</small>
            </span>
            <span className={s.chevron} aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Only renders the already authorized server projection; no client task inference. */
export function NotesRecords({
  data,
  query = '',
  open,
  historyOpen = false,
  onHistoryToggle,
}: {
  data: PlayerRecords;
  query?: string;
  open: Open;
  historyOpen?: boolean;
  onHistoryToggle?: (value: boolean) => void;
}) {
  const current = searchRecords(data.current, query);
  const about = searchRecords(data.about, query);
  const history = searchRecords(data.history, query);
  const searching = Boolean(query.trim());
  return (
    <div className={s.records}>
      <section className={s.section} aria-label="眼下要做的事">
        <h3>眼下要做的事</h3>
        <p className={s.hint}>这里只记录近期计划、建议和邀约。</p>
        {current.length ? (
          <RecordRows records={current} open={open} />
        ) : (
          <div className={s.empty}>
            <p>{searching ? '没有找到相关事项' : '暂时没有已记录的事项'}</p>
            {!searching && (
              <div className={s.links}>
                <button type="button" onClick={() => open('messages')}>
                  看看微信
                </button>
                <button type="button" onClick={() => open('calendar')}>
                  看看日历
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <section className={s.section} aria-label="关于这段人生">
        <h3>关于这段人生</h3>
        <p className={s.hint}>人生起点的身份与处境。</p>
        {about.length ? (
          <RecordRows records={about} open={open} />
        ) : (
          <p className={s.empty}>{searching ? '没有找到相关信息' : '人生起点的信息还未记录'}</p>
        )}
      </section>
      {data.history.length > 0 && (
        <details
          className={s.history}
          open={searching || historyOpen}
          onToggle={(event) => {
            if (!searching) onHistoryToggle?.(event.currentTarget.open);
          }}
        >
          <summary>
            此前记录 <span>{history.length}</span>
          </summary>
          {history.length ? (
            <RecordRows records={history} open={open} />
          ) : (
            <p className={s.empty}>没有找到相关的此前记录</p>
          )}
        </details>
      )}
    </div>
  );
}

export function NotesRecordDetail({
  data,
  target,
  open,
}: {
  data: PlayerRecords;
  target: string;
  open: Open;
}) {
  const record = [...data.current, ...data.about, ...data.history].find(
    (item) => item.id === target,
  );
  if (!record)
    return (
      <div className={s.detail}>
        <h2>这条记录暂时无法打开</h2>
        <p className={s.hint}>它可能已不在近期记录中，请返回列表查看。</p>
        <button type="button" className={s.linkButton} onClick={() => open('notes')}>
          返回备忘录
        </button>
      </div>
    );
  const destination = recordDestination(record);
  return (
    <article className={s.detail} data-system-record={record.id}>
      <p className={s.attribution}>{attribution[record.assertion]}</p>
      <h2>{record.title}</h2>
      <span className={s.state}>{record.stateLabel}</span>
      <p className={s.body}>{record.text}</p>
      <div className={s.source}>
        {record.source.kind === 'opening_field' ? (
          <p>来自这段人生的起点</p>
        ) : (
          <p>
            {record.source.timeBasis === 'story' ? '故事时间' : '记录时间'} ·{' '}
            {timeText(record.source.at)}
          </p>
        )}
        {destination ? (
          <button
            type="button"
            className={s.linkButton}
            onClick={() => open(destination.app, destination.target)}
          >
            {destination.app === 'messages' ? '查看对话' : '查看日程'}
            <span aria-hidden="true"> ›</span>
          </button>
        ) : (
          record.source.kind === 'world_event' && (
            <p className={s.hint}>来源已记录，暂时无法打开对话或日程。</p>
          )
        )}
      </div>
    </article>
  );
}

/** This error/loading belongs to records only; it must not replace private drafts. */
export function NotesRecordsReadState({
  status,
  error,
  reload,
}: {
  status: 'loading' | 'error';
  error?: string;
  reload?: () => void;
}) {
  return (
    <section className={s.readState} aria-label="人生记录读取状态">
      {status === 'loading' ? (
        <p role="status">正在读取人生记录…</p>
      ) : (
        <>
          <p role="alert">{error || '暂时无法读取人生记录'}</p>
          {reload && (
            <button type="button" className={s.linkButton} onClick={reload}>
              重新读取
            </button>
          )}
        </>
      )}
    </section>
  );
}
