import type { PublisherSchedule } from '../../contracts/publisher-preparation.ts';
import s from './publisher-schedule-review.module.css';

type Content = Record<string, unknown>;
const record = (value: unknown): Content =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Content) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
function atPath(content: Content, path: readonly (string | number)[]): unknown {
  let value: unknown = content;
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}
function actorName(content: Content, key: unknown) {
  if (typeof key !== 'string' || !key) return '发送人待核对';
  const actors = list(content.actors)
    .map(record)
    .filter((actor) => actor.key === key);
  return actors.length === 1 ? text(actors[0]!.name) || '未命名人物' : '发送人待核对';
}
export function scheduleLocation(content: Content, path: readonly (string | number)[]) {
  if (path[0] === 'world' && path[1] === 'startAt') return '故事开场';
  if (path[0] === 'phone' && path[1] === 'messages' && typeof path[2] === 'number') {
    const message = record(list(record(content.phone).messages)[path[2]]);
    return `开场消息 ${path[2] + 1} · ${actorName(content, message.actorKey)}${text(message.text) ? `：${text(message.text)}` : ''}`;
  }
  const categories: Record<string, string> = {
    history: '已发生的事',
    stages: '故事阶段',
    candidates: '可能发生的剧情',
    invitations: '邀约',
  };
  const timeline = path[0] === 'timeline' && path[1] === 'stages';
  const phone = path[0] === 'phone' && path[1] === 'invitations';
  const group = timeline ? 'stages' : phone ? 'invitations' : String(path[0]);
  const index = path[timeline || phone ? 2 : 1];
  if (typeof index === 'number' && categories[group]) {
    const row = record(
      list(
        timeline
          ? record(content.timeline).stages
          : phone
            ? record(content.phone).invitations
            : content[group],
      )[index],
    );
    return `${categories[group]} ${index + 1} · ${text(row.title) || text(row.text) || '未命名条目'}`;
  }
  return '一项时间设置';
}
export function scheduleTime(value: unknown) {
  if (value === undefined || value === null || value === '') return '尚未安排';
  if (typeof value !== 'string') return '时间格式待核对';
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
const issues: Record<string, string> = {
  scheduling_source_time_needs_review: '原稿或正文中已有时间线索尚未定位，请先核对；没有替你改写。',
  scheduling_unsupported_relative_delay:
    '“事件发生后再等几天或几小时”暂不能可靠安排，没有擅自改成开场后的时间。',
  scheduling_invalid_time: '已有时间格式无法识别，原值已保留，请核对。',
  scheduling_explicit_constraint_incomplete: '已经指定的日期条件还未填完整，请补齐或核对。',
  scheduling_invalid_window: '指定的开始与到期时间需核对。',
  scheduling_window_conflict: '已有时段限制互相冲突，请核对。',
  scheduling_start_outside_window: '开场时间不在指定时段内，请核对原有日期。',
  scheduling_expired_window: '指定时段在开场前已到期，请核对。',
  scheduling_no_feasible_start: '已有固定时间互相冲突，无法可靠安排开场。',
  scheduling_no_time_gap: '现有时间之间没有足够间隔，无法保持原有顺序。',
  scheduling_ambiguous_time_order: '已有先后顺序不明确或与日期冲突，请核对。',
  scheduling_history_after_start: '已发生的事晚于故事开场，请核对。',
  scheduling_message_not_past: '过去的对话没有安排在开场之前，请核对。',
  scheduling_invitation_before_start: '邀约时间早于故事开场，请核对。',
  scheduling_candidate_before_start: '可能发生的剧情时间早于开场，请核对。',
  scheduling_invalid_dependency: '有剧情引用未能对应，请核对前置事项。',
  scheduling_dependency_conflict: '剧情前后依赖存在冲突，请核对。',
  scheduling_unknown_stage: '所属故事阶段未能对应，请核对。',
  scheduling_ambiguous_key: '有条目标识缺失或重复，无法可靠对应，请核对。',
  scheduling_unknown_history_kind: '这条历史记录的类别尚不明确，请核对。',
  scheduling_unknown_message_origin: '这条消息是过去对话还是开场来信尚不明确，请核对。',
  scheduling_unknown_invitation_status: '邀约状态尚不明确，请核对。',
  scheduling_unknown_message: '这条关联消息未能对应，请核对。',
  explicit_time_conflict: '原稿中的明确时间存在冲突，请核对；不会替你覆盖日期。',
};
const reasons: Record<string, string> = {
  default_start: '在已有日期限制内，补齐缺省开场时间。',
  default_history_order: '按已有列表顺序，将缺少日期的历史事项安排在开场前。',
  default_opening_message: '将缺少时间的开场来信安排在开场时。',
  default_history_message_order: '按已有顺序，将缺少日期的过去对话安排在开场前。',
  default_proposed_invitation: '在开场后补齐邀约的缺省时间，不表示已经确认赴约。',
  default_invitation_lower_bound: '依据开场、所属阶段与前置条件，补齐邀约最早时间。',
};
function reason(value: string) {
  return (
    reasons[value] ??
    (/[\u3400-\u9fff]/.test(value) ? value : '按照本次排期规则补齐缺省时间，请对照原稿核对。')
  );
}
/** Read-only metadata paired with the exact current content; never runs the planner or writes a draft. */
export function PublisherScheduleReview({
  schedule,
  content,
  context = 'import',
}: {
  schedule: PublisherSchedule;
  content: Content;
  context?: 'draft' | 'import';
}) {
  const mismatch =
    schedule.status !== 'blocked' &&
    schedule.changes.some((change) => atPath(content, change.path) !== change.value);
  return (
    <section className={s.review} aria-label="时间安排">
      <h3>时间安排</h3>
      <p role="status">
        {schedule.status === 'blocked'
          ? context === 'draft'
            ? '有时间问题待处理，本次未修改草稿。'
            : '未自动安排时间，已有提取内容可核对；仍需处理时间问题，不能直接发布。'
          : schedule.status === 'unchanged'
            ? '未新增时间安排，已有内容保持原样。'
            : context === 'draft'
              ? '缺省时间已安排到当前编辑稿，尚未保存。'
              : '以下时间已用于本次整理稿，填入后仍需保存。'}
      </p>
      <p className={s.help}>
        按北京时间展示。系统安排供故事运行使用，请核对先后与原稿含义；不代表这些事件已经发生。
      </p>
      {mismatch && (
        <p className={s.warning} role="alert">
          排期记录与当前内容不一致，请重新安排；不将旧记录当作当前时间。
        </p>
      )}
      {schedule.issues.length > 0 && (
        <details className={s.warning} open={schedule.issues.length <= 5}>
          <summary>需要核对的时间（{schedule.issues.length} 项）</summary>
          <ul>
            {schedule.issues.map((issue, index) => (
              <li key={index}>
                <strong>{scheduleLocation(content, issue.path)}</strong>
                <p>{issues[issue.code] ?? '这处时间暂未能可靠安排，请核对原稿与现有时间。'}</p>
                {issue.source && (
                  <details>
                    <summary>查看原文线索</summary>
                    <p>关联文稿：{issue.source.filename}</p>
                    <blockquote>{issue.source.quote}</blockquote>
                    <p>以上为待核对的文稿线索，不表示已验证原稿全部时序。</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {schedule.changes.length > 0 && (
        <details
          className={s.changes}
          open={schedule.status === 'proposed' && schedule.changes.length <= 5}
        >
          <summary>
            {schedule.status === 'blocked' ? '未采用的安排线索' : '查看实际时间安排'}（
            {schedule.changes.length} 项）
          </summary>
          <ol>
            {schedule.changes.map((change, index) => {
              const actual = atPath(content, change.path),
                applied = schedule.status !== 'blocked' && actual === change.value;
              return (
                <li key={index}>
                  <strong>{scheduleLocation(content, change.path)}</strong>
                  <p>
                    {applied ? '安排时间' : '当前稿件时间'}：{scheduleTime(actual)}
                  </p>
                  <p className={s.help}>{reason(change.reason)}</p>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
