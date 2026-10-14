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
        {/* 手机试演常驻区域：有试演则始终展示手机，有修改提示保存 */}
        {isDirty && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              background: '#fef3c7',
              border: '1px solid #fde68a',
              color: '#92400e',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <span>当前有未保存的修改；试演运行的是已保存版本。</span>
            <button
              type="button"
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                background: '#b45309',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '12px',
              }}
              disabled={busy || !canEdit || saveBlocked || !onSave}
              onClick={onSave}
            >
              {busy ? '保存中…' : '保存草稿'}
            </button>
          </div>
        )}

        {trial ? (
          <div className={s.trialWrap}>
            <iframe
              className={s.phone}
              title="这份已保存草稿的真实试演手机"
              src={phoneTrialUrl(trial)}
            />
            {isDirty && (
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  zIndex: 2,
                }}
              >
                <span className={s.staleBadge}>已编辑（试演为旧版）</span>
                <button
                  type="button"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: '#1d4ed8',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                  }}
                  disabled={busy || !onStartTrial || saveBlocked}
                  onClick={() => onStartTrial?.()}
                >
                  {busy ? '更新中…' : '同步更新试演'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={s.empty}>
            <p>
              {isDirty
                ? '有未保存的修改，点击下方按钮将自动保存并进入手机试演。'
                : '保存后试演，查看玩家实际会使用的手机与角色对话、朋友圈。'}
            </p>
            <button
              type="button"
              disabled={busy || !onStartTrial || saveBlocked}
              onClick={() => {
                onStartTrial?.();
              }}
            >
              {busy ? '正在启动试演…' : '试演这份草稿'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
