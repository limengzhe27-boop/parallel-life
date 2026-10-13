'use client';
import { publicationLocalTime, publicationUtcTime } from './publisher-story-time.ts';
import s from './publisher-workbench.module.css';
import p from './publisher-plot-editor.module.css';
type Row = Record<string, unknown>;
export function PublisherOpeningEditor({
  content,
  disabled,
  onChange,
}: {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const phone = content.phone;
  if (!phone || typeof phone !== 'object' || Array.isArray(phone))
    return <p>开场手机内容格式需要整理，原稿未修改。</p>;
  const base = phone as Row;
  if (
    !Array.isArray(base.messages) ||
    base.messages.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    return <p>开场消息格式需要整理，原稿未修改。</p>;
  const messages = base.messages as Row[];
  const actors = Array.isArray(content.actors)
    ? (content.actors.filter(
        (row) => row && typeof row === 'object' && !Array.isArray(row),
      ) as Row[])
    : [];
  const update = (index: number, patch: Row) => {
    if (!disabled)
      onChange({
        ...content,
        phone: {
          ...base,
          messages: messages.map((row, i) => (i === index ? { ...row, ...patch } : row)),
        },
      });
  };
  return (
    <section className={s.card} aria-label="开场消息编辑">
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>5. 开场时手机里已有的消息</h3>
        <p className={s.sectionHint}>
          先核对发送人、原文和消息类别。已有时间收在下方；缺少的必填时间会展开提示，不会自动改写。
        </p>
      </div>
      {messages.map((message, index) => {
        const localTime = publicationLocalTime(typeof message.at === 'string' ? message.at : '');
        const needsTime = !localTime;
        return (
          <fieldset key={String(message.key ?? index)} disabled={disabled} className={p.message}>
            <legend>消息 {index + 1}</legend>
            <div className={s.formGrid}>
              <label className={s.formField}>
                发送人物
                <select
                  className={s.input}
                  value={typeof message.actorKey === 'string' ? message.actorKey : ''}
                  onChange={(event) => update(index, { actorKey: event.target.value })}
                >
                  <option value="">选择开场已认识的人物</option>
                  {actors
                    .filter((a) => a.knownAtStart === true)
                    .map((actor) => (
                      <option key={String(actor.key)} value={String(actor.key)}>
                        {String(actor.name || '待命名人物')}
                      </option>
                    ))}
                </select>
              </label>
              <label className={s.formField}>
                消息类别
                <select
                  className={s.input}
                  value={typeof message.origin === 'string' ? message.origin : ''}
                  onChange={(event) => update(index, { origin: event.target.value })}
                >
                  <option value="">选择消息类别</option>
                  <option value="history">过去的对话</option>
                  <option value="incoming">开场来信</option>
                </select>
              </label>
              <label className={s.formFieldFull}>
                消息原文
                <textarea
                  className={s.textarea}
                  rows={3}
                  maxLength={500}
                  value={typeof message.text === 'string' ? message.text : ''}
                  onChange={(event) => update(index, { text: event.target.value })}
                />
              </label>
              <details className={`${s.formFieldFull} ${p.advanced}`} open={needsTime}>
                <summary>发送时间 · {needsTime ? '待补齐' : localTime.replace('T', ' ')}</summary>
                <div className={p.advancedBody}>
                  {needsTime && (
                    <p role="status">
                      这条消息缺少有效时间，试演前需要补齐。可通过系统整理后核对；尚未自动安排。
                    </p>
                  )}
                  <p>已有消息不能晚于世界开场；过去对话须早于开场。时间按北京时间显示。</p>
                  <label className={s.formField}>
                    发送时间（北京时间）
                    <input
                      className={s.input}
                      type="datetime-local"
                      value={publicationLocalTime(typeof message.at === 'string' ? message.at : '')}
                      onChange={(event) => {
                        try {
                          update(index, { at: publicationUtcTime(event.target.value) });
                        } catch {
                          /* Invalid native input is not saved as a fabricated time. */
                        }
                      }}
                    />
                  </label>
                </div>
              </details>
            </div>
            <button
              type="button"
              className={s.btn}
              disabled={
                disabled ||
                (Array.isArray(base.invitations) &&
                  base.invitations.some((invitation) => invitation?.messageKey === message.key))
              }
              title={
                Array.isArray(base.invitations) &&
                base.invitations.some((invitation) => invitation?.messageKey === message.key)
                  ? '这条消息关联了开场邀约，请先整理关联的邀约。'
                  : undefined
              }
              onClick={() => {
                if (!disabled)
                  onChange({
                    ...content,
                    phone: { ...base, messages: messages.filter((_, i) => i !== index) },
                  });
              }}
            >
              移除消息
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        className={s.btn}
        disabled={disabled || messages.length >= 40}
        onClick={() => {
          if (disabled || messages.length >= 40) return;
          const keys = new Set(messages.map((m) => m.key));
          let i = 1;
          while (keys.has(`message_new_${i}`)) i++;
          onChange({
            ...content,
            phone: {
              ...base,
              messages: [
                ...messages,
                { key: `message_new_${i}`, actorKey: '', origin: 'history', text: '', at: '' },
              ],
            },
          });
        }}
      >
        添加已有消息
      </button>
    </section>
  );
}
