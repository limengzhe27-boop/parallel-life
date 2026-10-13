'use client';

import {
  CHARACTER_MODULES,
  characterPreview,
  characterModuleText,
  updateCharacterField,
} from './publisher-character-model.ts';
import { phoneTrialUrl, type PublisherPhoneTrial } from './publisher-phone-trial.ts';
import s from './publisher-character-preview.module.css';

type Props = {
  content: Record<string, unknown>;
  actorKey: string;
  canEdit: boolean;
  busy: boolean;
  isDirty?: boolean;
  saveBlocked?: boolean;
  trial?: PublisherPhoneTrial | null;
  onStartTrial?: () => void;
  onSave?: () => void;
  onCloseTrial?: () => void;
  onChange: (content: Record<string, unknown>) => void;
};
export function PublisherCharacterPreview({
  content,
  actorKey,
  canEdit,
  busy,
  isDirty = false,
  saveBlocked = false,
  trial,
  onStartTrial,
  onSave,
  onCloseTrial,
  onChange,
}: Props) {
  const person = characterPreview(content, actorKey);
  if (!person) return <p className={s.empty}>请先核对人物，重复的人物暂不能预览。</p>;
  const name = person.name || '未命名人物';
  return (
    <div className={s.character}>
      <section className={s.phonePane} aria-label="真实手机试演">
        <div className={s.header}>
          <h3>手机试演</h3>
          {trial && onCloseTrial && (
            <button type="button" onClick={onCloseTrial}>
              收起试演
            </button>
          )}
        </div>
        <p className={s.hint}>
          在手机微信中选择联系人，查看人物资料、朋友圈并直接聊天。试演使用独立存档。
        </p>
        {isDirty ? (
          <div className={s.empty}>
            <p>有未保存的修改，先保存这份草稿，再进入手机试演。</p>
            <button
              type="button"
              disabled={busy || !canEdit || saveBlocked || !onSave}
              onClick={onSave}
            >
              {busy ? '正在处理…' : '保存草稿'}
            </button>
          </div>
        ) : trial ? (
          <iframe
            className={s.phone}
            title="这份已保存草稿的真实试演手机"
            src={phoneTrialUrl(trial)}
          />
        ) : (
          <div className={s.empty}>
            <p>保存后试演，查看玩家实际会使用的手机。</p>
            <button
              type="button"
              disabled={busy || !onStartTrial || isDirty || saveBlocked}
              onClick={onStartTrial}
            >
              {busy ? '正在准备…' : '试演这份草稿'}
            </button>
          </div>
        )}
      </section>
      <div className={s.manuscript}>
        <section className={s.introduction} aria-label="角色介绍文稿">
          <h3>{name} · 角色介绍</h3>
          {person.identity && <p className={s.hint}>{person.identity}</p>}
          <p className={s.publicText}>{person.introduction || '尚未填写给玩家看的角色介绍。'}</p>
        </section>
        <details className={s.editing}>
          <summary>编辑人物设定</summary>
          <p className={s.hint}>
            五个模块保存编剧的人物设定，按已有材料填写。玩家只看到单独核对的公开介绍。
          </p>
          <label className={s.field}>
            给玩家看的角色介绍
            <textarea
              rows={4}
              value={person.introduction}
              maxLength={1600}
              disabled={!canEdit || busy}
              onChange={(e) =>
                onChange(updateCharacterField(content, actorKey, 'introduction', e.target.value))
              }
            />
          </label>
          {CHARACTER_MODULES.map((module) => (
            <label className={s.field} key={module.key}>
              {module.label}
              <textarea
                rows={5}
                value={characterModuleText(content, actorKey, module.key)}
                maxLength={4000}
                disabled={!canEdit || busy}
                onChange={(e) =>
                  onChange(updateCharacterField(content, actorKey, module.key, e.target.value))
                }
              />
            </label>
          ))}
        </details>
      </div>
    </div>
  );
}
