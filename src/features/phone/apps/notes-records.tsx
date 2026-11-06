import type { PlayerRecords } from '../../../contracts/world-records.ts';
import { invitationTask, playerTask } from '../desktop-widget-selection.ts';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
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

function RecordRows({
  records,
  open,
  referenceTime,
}: {
  records: readonly RecordItem[];
  open: Open;
  referenceTime?: string;
}) {
  return (
    <ul className={s.rows}>
      {records.map((record) => {
        const destination = recordDestination(record);
        const task = playerTask(record, referenceTime);
        const title = task?.title ?? record.title;
        const stateLabel = task?.stateLabel ?? record.stateLabel;
        return (
          <li key={record.id} className={s.rowItem}>
            <button
              type="button"
              className={s.row}
              onClick={() => open('records', record.id)}
              aria-label={`${title}，${stateLabel}${record.stepChecklist ? `，已完成 ${record.stepChecklist.completedRequired}/${record.stepChecklist.requiredTotal}` : ''}`}
            >
              <span className={s.rowText}>
                <strong>{title}</strong>
                <span className={s.preview}>{recordText(record)}</span>
                <span className={s.metaGroup}>
                  <small className={s.stateBadge}>{stateLabel}</small>
                  <small className={s.attributionBadge}>
                    {task?.recommended ? '剧情建议' : recordAttribution(record)}
                  </small>
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
                  {task
                    ? `${task.actionLabel} ›`
                    : destination.app === 'map'
                      ? '前往现场推进 ›'
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

export function isNotesBackgroundRecord(record: RecordItem) {
  return (
    record.kind === 'opening_context' ||
    (record.span !== 'pursuit' && record.kind !== 'world_matter')
  );
}
function ordinaryInvitation(record: RecordItem, referenceTime?: string) {
  return (
    record.kind === 'invitation' &&
    !invitationTask(record, referenceTime) &&
    !record.opportunity &&
    !record.progress &&
    !record.stepChecklist
  );
}
export function NotesAbout({
  data,
  query = '',
  open,
}: {
  data: PlayerRecords;
  query?: string;
  open: Open;
}) {
  const situations = searchRecords(data.about.filter(isNotesBackgroundRecord), query);
  return (
    <div className={s.records}>
      <p className={s.hint}>人生起点的身份与处境，来自这段人生已有的记录。</p>
      {situations.length ? (
        <RecordRows records={situations} open={open} />
      ) : (
        <p className={s.empty}>{query.trim() ? '没有找到相关背景' : '人生起点的信息还未记录'}</p>
      )}
    </div>
  );
}

/** Only renders the already authorized server projection; no client task inference. */
export function NotesRecords({
  data,
  query = '',
  open,
  historyOpen = false,
  onHistoryToggle,
  referenceTime,
}: {
  data: PlayerRecords;
  query?: string;
  open: Open;
  historyOpen?: boolean;
  onHistoryToggle?: (value: boolean) => void;
  referenceTime?: string;
}) {
  const current = searchRecords(
    data.current.filter((record) => !ordinaryInvitation(record, referenceTime)),
    query,
  );
  const opportunities = current.filter((record) => record.opportunity);
  const otherCurrent = current.filter((record) => !record.opportunity);
  const pursuits = searchRecords(
    data.about.filter((r) => r.span === 'pursuit' && r.kind === 'world_matter'),
    query,
  );
  const history = searchRecords(
    data.history.filter((record) => !ordinaryInvitation(record)),
    query,
  );
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
        <p className={s.hint}>记录近期事项与建议，进展随实际行动更新。</p>
        {otherCurrent.length ? (
          <RecordRows records={otherCurrent} open={open} referenceTime={referenceTime} />
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
      {pursuits.length > 0 && (
        <section className={s.section} aria-label="长期目标">
          <h3>长期目标</h3>
          <RecordRows records={pursuits} open={open} />
        </section>
      )}
      <div className={s.links}>
        <button type="button" onClick={() => open('calendar')}>
          邀约与日程，去日历查看
        </button>
      </div>
      {data.history.some((record) => !ordinaryInvitation(record)) && (
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
  referenceTime,
  deferTask,
}: {
  data: PlayerRecords;
  target: string;
  open: Open;
  referenceTime?: string;
  deferTask?: (key: string) => void;
}) {
  const record = [...data.current, ...data.about, ...data.history].find(
    (item) => item.id === target,
  );
  if (!record)
    return (
      <div className={s.detail}>
        <h2>这条记录暂时无法打开</h2>
        <p className={s.hint}>它可能已不在近期记录中，请返回列表查看。</p>
        <button type="button" className={s.linkButton} onClick={() => open('records')}>
          返回人生记录
        </button>
      </div>
    );
  const destination = recordDestination(record);
  const task = playerTask(record, referenceTime);
  const origin =
    record.origin ?? (record.source.kind === 'world_genesis' ? record.source : undefined);
  const related = (record.relatedLinks ?? []).filter(
    (link) => !(destination && link.app === destination.app && link.target === destination.target),
  );
  return (
    <article className={s.detail} data-system-record={record.id}>
      <p className={s.attribution}>{task?.recommended ? '剧情建议' : recordAttribution(record)}</p>
      <h2>{task?.title ?? record.title}</h2>
      {record.kind === 'world_matter' && task && task.title !== record.title && (
        <p className={s.hint}>所属事项 · {record.title}</p>
      )}
      <span className={s.state}>{task?.stateLabel ?? record.stateLabel}</span>
      {task?.reason !== recordText(record) && <p className={s.body}>{recordText(record)}</p>}
      {task?.reason && <p className={s.body}>为什么 · {task.reason}</p>}
      {task && deferTask && (
        <button type="button" className={s.linkButton} onClick={() => deferTask(task.key)}>
          先放着
        </button>
      )}
      {record.opportunity && (
        <div className={s.opportunityOrigin}>
          <span>这是一个可以尝试的机会，还没有替你作决定。</span>
          <button
            className={s.linkButton}
            type="button"
            onClick={() => open('records', record.opportunity!.triggerRecordId)}
          >
            看看它从哪里来 ›
          </button>
          <button
            className={s.linkButton}
            type="button"
            onClick={() => open('records', record.opportunity!.pursuitRecordId)}
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
                    onClick={() => open('records', step.recordId)}
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
                  onClick={() => open('records', step.recordId)}
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
            {task
              ? task.actionLabel
              : destination.app === 'messages'
                ? record.kind === 'world_matter'
                  ? '联系相关人物'
                  : '查看来源对话'
                : destination.app === 'map'
                  ? '前往现场推进'
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

/** Standalone RecordsApp: dedicated read-only viewer for world background and player records */
export function RecordsApp({ target, open }: PhoneAppContext) {
  const { data, records, reloadRecords, drafts, setDraft, taskDeferrals } = usePhoneApps();
  const query = drafts['records:search'] ?? '';
  const setQuery = (value: string) => setDraft('records:search', value);
  const reload = reloadRecords
    ? () => {
        void reloadRecords();
      }
    : undefined;

  if (target) {
    return (
      <div className={`${s.records} ${s.notesPage}`}>
        <nav className={s.recordNavigation} aria-label="人生记录导航">
          <button
            type="button"
            className={s.recordBack}
            aria-label="返回人生记录"
            onClick={() => open('records')}
          >
            <span aria-hidden="true">‹</span> 人生记录
          </button>
        </nav>
        {records.status === 'ready' ? (
          <NotesRecordDetail
            data={records.data}
            target={target}
            open={open}
            referenceTime={data.referenceTime}
            deferTask={
              taskDeferrals &&
              ((key) => {
                taskDeferrals.defer(key);
                open('records');
              })
            }
          />
        ) : (
          <NotesRecordsReadState
            status={records.status}
            error={records.status === 'error' ? records.error : undefined}
            reload={reload}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`${s.records} ${s.notesPage}`} style={{ padding: '0 12px 24px' }}>
      <header style={{ padding: '16px 4px 8px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>人生记录</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          查看当前事项、已经发生的事和人生起点
        </p>
      </header>

      {/* 搜索框 */}
      <div style={{ margin: '8px 0 16px' }}>
        <input
          type="search"
          value={query}
          placeholder="搜索人生记录…"
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            fontSize: '14px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {records.status === 'ready' ? (
        <NotesRecords
          data={records.data}
          query={query}
          open={open}
          historyOpen={drafts['records:history-open'] === 'true'}
          onHistoryToggle={(value) => setDraft('records:history-open', String(value))}
          referenceTime={data.referenceTime}
        />
      ) : (
        <NotesRecordsReadState
          status={records.status}
          error={records.status === 'error' ? records.error : undefined}
          reload={reload}
        />
      )}

      <section
        className={s.section}
        aria-label="关于这段人生"
        style={{
          margin: '0 0 16px',
          background: '#ffffff',
          padding: '14px',
          borderRadius: '12px',
          border: '1px solid #f1f5f9',
        }}
      >
        <details className={s.background} open={Boolean(query.trim())}>
          <summary
            style={{
              fontWeight: 650,
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>关于这段人生（起点与设定）</span>
            <small style={{ fontSize: '12px', color: '#64748b', fontWeight: 'normal' }}>只读</small>
          </summary>
          <p className={s.hint} style={{ margin: '6px 0 10px' }}>
            查看开场时已经知道的背景与处境。
          </p>
          {records.status === 'ready' ? (
            <NotesAbout data={records.data} query={query} open={open} />
          ) : null}
        </details>
      </section>

      {data.choices && data.choices.length > 0 && (
        <section
          className={s.section}
          aria-label="面临的处境与选择"
          style={{
            margin: '16px 0 0',
            background: '#ffffff',
            padding: '14px',
            borderRadius: '12px',
            border: '1px solid #f1f5f9',
          }}
        >
          <details
            className={s.background}
            open={
              !query.trim() ||
              !!data.choices.some((c) => searchable(query, c.actorName, c.quote, c.intent))
            }
          >
            <summary
              style={{
                fontWeight: 650,
                fontSize: '16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>处境与选择</span>
              <small style={{ fontSize: '12px', color: '#64748b', fontWeight: 'normal' }}>
                {data.choices.length} 条处境与选择（只读）
              </small>
            </summary>
            <p className={s.hint} style={{ margin: '6px 0 10px' }}>
              人物来信或对话中带来的关键处境与分歧。选择已发生或待续，不在此处就地编辑。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.choices
                .filter(
                  (choice) =>
                    !query.trim() ||
                    searchable(query, choice.actorName, choice.quote, choice.intent),
                )
                .map((choice) => (
                  <div
                    key={choice.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: '13px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                      }}
                    >
                      <strong style={{ color: '#0f172a' }}>{choice.actorName} · 处境</strong>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: choice.status === 'pending' ? '#fef3c7' : '#f1f5f9',
                          color: choice.status === 'pending' ? '#92400e' : '#475569',
                          fontWeight: 500,
                        }}
                      >
                        {choice.status === 'pending' ? '待续 / 待决定' : '已跟进'}
                      </span>
                    </div>
                    <p style={{ margin: '2px 0 4px', color: '#334155' }}>
                      <span style={{ color: '#64748b' }}>你说：</span>“{choice.quote}”
                    </p>
                    {choice.nextStep && (
                      <div
                        style={{
                          marginTop: '6px',
                          paddingTop: '6px',
                          borderTop: '1px dashed #cbd5e1',
                        }}
                      >
                        <p style={{ margin: '0 0 4px', color: '#475569', fontSize: '12px' }}>
                          <span>{choice.actorName}提出：</span>
                          {choice.nextStep.quote}
                        </p>
                        {choice.nextStep.calendar && (
                          <button
                            type="button"
                            className={s.actionShortcut}
                            onClick={() =>
                              choice.nextStep?.calendar &&
                              open('calendar', choice.nextStep.calendar.id)
                            }
                            style={{ marginTop: '4px' }}
                          >
                            📅 查看日历日程 · {choice.nextStep.calendar.title} ›
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
