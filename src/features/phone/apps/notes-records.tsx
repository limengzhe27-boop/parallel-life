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
  world_verified: '世界核实',
};

export function recordAttribution(record: RecordItem): string {
  return record.kind === 'history_message' ? '虚构起点来信' : attribution[record.assertion];
}

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
  if (navigation?.app === 'map') return { app: 'map' as const, target: navigation.placeId };
  return undefined;
}

/** Only the invitation timestamp is presentation formatting, never a new fact or changed time. */
export function recordText(record: RecordItem): string {
  if (record.kind !== 'invitation') return record.text;
  const formatted = timeText(record.text);
  return formatted ? `约定时间：${formatted}` : record.text;
}

export function searchRecords(records: readonly RecordItem[], query: string): RecordItem[] {
  return records.filter((record) =>
    searchable(
      query,
      record.title,
      record.text,
      recordText(record),
      record.stateLabel,
      recordAttribution(record),
      ...(record.progress?.milestones.map((step) => step.title) ?? []),
      ...(record.progress?.opportunities.map((step) => step.title) ?? []),
    ),
  );
}

function RecordRows({ records, open }: { records: readonly RecordItem[]; open: Open }) {
  return (
    <ul className={s.rows}>
      {records.map((record) => {
        const destination = recordDestination(record);
        return (
          <li key={record.id} className={s.rowItem}>
            <button
              type="button"
              className={s.row}
              onClick={() => open('notes', record.id)}
              aria-label={`${record.title}，${record.stateLabel}${record.stepChecklist ? `，已完成 ${record.stepChecklist.completedRequired}/${record.stepChecklist.requiredTotal}` : ''}`}
            >
              <span className={s.rowText}>
                <strong>{record.title}</strong>
                <span className={s.preview}>{recordText(record)}</span>
                <span className={s.metaGroup}>
                  <small className={s.stateBadge}>{record.stateLabel}</small>
                  <small className={s.attributionBadge}>{recordAttribution(record)}</small>
                </span>
                {record.stepChecklist && (
                  <span className={s.checklistSummary}>
                    已完成 {record.stepChecklist.completedRequired}/
                    {record.stepChecklist.requiredTotal}
                  </span>
                )}
                {record.progress?.milestones.length ? (
                  <span className={s.progressSummary}>
                    已走过 {record.progress.milestones.length} 步 ·{' '}
                    {record.progress.milestones.at(-1)?.title}
                  </span>
                ) : null}
              </span>
              <span className={s.chevron} aria-hidden="true">
                ›
              </span>
            </button>
            {destination && (
              <div className={s.rowAction}>
                <button
                  type="button"
                  className={s.actionShortcut}
                  onClick={() => open(destination.app, destination.target)}
                >
                  {destination.app === 'map'
                    ? '查看地点 ›'
                    : destination.app === 'messages'
                      ? record.kind === 'world_matter'
                        ? '联系相关人物 ›'
                        : '查看来源对话 ›'
                      : '查看日程 ›'}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Completion comes only from the schema-checked server record, never input or task feedback. */
function StepChecklist({ checklist }: { checklist: NonNullable<RecordItem['stepChecklist']> }) {
  const rows = (steps: typeof checklist.steps) => (
    <ol className={s.checklistRows}>
      {steps.map((step) => {
        const completed = step.state === 'completed';
        const actor = step.actorName ?? '人物';
        const action = step.id === 'received' ? '接收' : '检查';
        const label =
          step.performer === 'player'
            ? completed
              ? '你已完成'
              : '待你继续'
            : completed
              ? `${actor}已${action}`
              : `等待人物${action}`;
        return (
          <li key={step.id} data-step-id={step.id}>
            <span className={completed ? s.completedMark : s.pendingMark} aria-hidden="true">
              {completed ? '✓' : '○'}
            </span>
            <div className={s.checklistText}>
              <strong>{step.title}</strong>
              <span className={s.checklistStatus}>{label}</span>
              {completed && step.at && <time dateTime={step.at}>{timeText(step.at)}</time>}
            </div>
          </li>
        );
      })}
    </ol>
  );
  return (
    <section className={s.checklist} aria-label="这件事的进展">
      <h3>这件事的进展</h3>
      <p className={s.checklistSummary}>
        已完成 {checklist.completedRequired}/{checklist.requiredTotal}
      </p>
      <p className={s.hint}>交出东西与对方收到，是两步。</p>
      <div role="group" aria-label="必需步骤">
        {rows(checklist.steps.filter((step) => step.required))}
      </div>
      <details className={s.optionalSteps}>
        <summary>可选记录</summary>
        <p className={s.hint}>这些记录不计入必需步骤。</p>
        {rows(checklist.steps.filter((step) => !step.required))}
      </details>
    </section>
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
  const opportunities = current.filter((record) => record.opportunity);
  const otherCurrent = current.filter((record) => !record.opportunity);
  const pursuits = searchRecords(
    data.about.filter((r) => r.span === 'pursuit' || r.kind === 'world_matter'),
    query,
  );
  const situations = searchRecords(
    data.about.filter(
      (r) => r.kind === 'opening_context' || (r.span !== 'pursuit' && r.kind !== 'world_matter'),
    ),
    query,
  );
  const history = searchRecords(data.history, query);
  const searching = Boolean(query.trim());
  return (
    <div className={s.records}>
      {opportunities.length > 0 && (
        <section className={s.section} aria-label="接下来可以试试">
          <h3>接下来可以试试</h3>
          <p className={s.hint}>刚发生的事，带来了新的可能。要不要继续，由你决定。</p>
          <RecordRows records={opportunities} open={open} />
        </section>
      )}
      <section className={s.section} aria-label="眼下要做的事">
        <h3>眼下要做的事</h3>
        <p className={s.hint}>这里只记录近期计划、建议和邀约。</p>
        {otherCurrent.length ? (
          <RecordRows records={otherCurrent} open={open} />
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
                <button type="button" onClick={() => open('map')}>
                  看看地图
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <section className={s.section} aria-label="这段人生想做到的事">
        <h3>这段人生想做到的事</h3>
        <p className={s.hint}>想慢慢做成的事，也记下已经走过的路。</p>
        {pursuits.length ? (
          <RecordRows records={pursuits} open={open} />
        ) : (
          <p className={s.empty}>{searching ? '没有找到相关追求' : '暂时没有已记录的长期追求'}</p>
        )}
      </section>
      <section className={s.section} aria-label="现在的处境">
        <h3>现在的处境</h3>
        <p className={s.hint}>关于这段人生 · 人生起点的身份与处境。</p>
        {situations.length ? (
          <RecordRows records={situations} open={open} />
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
  const origin =
    record.origin ?? (record.source.kind === 'world_genesis' ? record.source : undefined);
  const related = (record.relatedLinks ?? []).filter(
    (link) => !(destination && link.app === destination.app && link.target === destination.target),
  );
  return (
    <article className={s.detail} data-system-record={record.id}>
      <p className={s.attribution}>{recordAttribution(record)}</p>
      <h2>{record.title}</h2>
      <span className={s.state}>{record.stateLabel}</span>
      <p className={s.body}>{recordText(record)}</p>
      {record.opportunity && (
        <div className={s.opportunityOrigin}>
          <span>这是一个可以尝试的机会，还没有替你作决定。</span>
          <button
            className={s.linkButton}
            type="button"
            onClick={() => open('notes', record.opportunity!.triggerRecordId)}
          >
            看看它从哪里来 ›
          </button>
          <button
            className={s.linkButton}
            type="button"
            onClick={() => open('notes', record.opportunity!.pursuitRecordId)}
          >
            这一步通向哪里 ›
          </button>
        </div>
      )}
      {record.stepChecklist && <StepChecklist checklist={record.stepChecklist} />}
      {record.progress && (
        <section className={s.progress} aria-label="已经走过的路">
          <h3>已经走过的路</h3>
          <ol className={s.milestones}>
            {record.progress.milestones.map((step) => (
              <li key={step.recordId}>
                <span className={s.stepDot} aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{timeText(step.at)}</small>
                  <button
                    className={s.linkButton}
                    type="button"
                    onClick={() => open('notes', step.recordId)}
                  >
                    查看这一步 ›
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {record.progress.opportunities.length > 0 && (
            <div className={s.nextSteps}>
              <h3>接下来可以试试</h3>
              {record.progress.opportunities.map((step) => (
                <button
                  className={s.nextStep}
                  type="button"
                  key={step.recordId}
                  onClick={() => open('notes', step.recordId)}
                >
                  <span>{step.title}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          )}
          <p className={s.hint}>这些是已经发生的阶段成果，不代表这段追求已经完成。</p>
        </section>
      )}
      <div className={s.source}>
        {record.source.kind === 'world_genesis' ? (
          <p>来信时间 · {timeText(record.source.at)}</p>
        ) : record.source.kind === 'opening_field' ? (
          <p>来自这段人生的起点</p>
        ) : (
          <p>
            {origin && record.kind === 'invitation'
              ? '回应时间'
              : record.source.timeBasis === 'story'
                ? '故事时间'
                : '记录时间'}{' '}
            · {timeText(record.source.at)}
          </p>
        )}
        {origin && record.kind !== 'history_message' && (
          <p>源自虚构起点来信 · {timeText(origin.at)}</p>
        )}
        {destination ? (
          <button
            type="button"
            className={s.linkButton}
            onClick={() => open(destination.app, destination.target)}
          >
            {destination.app === 'messages'
              ? record.kind === 'world_matter'
                ? '联系相关人物'
                : '查看来源对话'
              : destination.app === 'map'
                ? '查看地点'
                : '查看日程'}
            <span aria-hidden="true"> ›</span>
          </button>
        ) : (
          record.source.kind === 'world_event' && (
            <p className={s.hint}>来源已记录，暂时无法打开对话或日程。</p>
          )
        )}
        {related.length > 0 && (
          <nav className={s.links} aria-label="关联内容">
            {related.map((link) => (
              <button
                type="button"
                className={s.linkButton}
                key={`${link.app}:${link.target}`}
                onClick={() => open(link.app, link.target)}
              >
                {link.app === 'messages'
                  ? record.kind === 'world_matter'
                    ? link.label
                    : '查看来源对话'
                  : link.app === 'photos'
                    ? '相关人物带入素材'
                    : link.label}
                <span aria-hidden="true"> ›</span>
              </button>
            ))}
          </nav>
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
