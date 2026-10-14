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
  allowTrialWhileSaving?: boolean;
  trialMessage?: string | null;
  trialError?: string;
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
  allowTrialWhileSaving = false,
  trialMessage,
  trialError,
  onSave,
  onCloseTrial,
  onChange,
}: Props) {
  const person = characterPreview(content, actorKey);
  if (!person) return <p className={s.empty}>请先核对人物，重复的人物暂不能预览。</p>;
  const name = person.name || '未命名人物';
  return (
    <div className={s.character}>
      <section className={s.phonePane} aria-label="角色微信试聊">
        <div className={s.header}>
          <h3>微信试聊 · {name}</h3>
          {trial && onCloseTrial && (
            <button type="button" onClick={onCloseTrial}>
              收起试演
            </button>
          )}
        </div>
        <p className={s.hint}>直接与{name}聊天，查看人物资料与朋友圈。试聊使用独立存档。</p>
        {trialMessage && (
          <p role="status" className={s.hint}>
            {trialMessage}
          </p>
        )}
        {trialError && (
          <p role="alert" className={s.trialError}>
            {trialError}
          </p>
        )}
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
              title={`与${name}的真实微信试聊`}
              src={phoneTrialUrl(trial, actorKey)}
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
                  disabled={(busy && !allowTrialWhileSaving) || !onStartTrial || saveBlocked}
                  onClick={() => onStartTrial?.()}
                >
                  {busy ? (allowTrialWhileSaving ? '保存后更新试演' : '更新中…') : '同步更新试演'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={s.empty}>
            <p>
              {isDirty
                ? '点击试聊会先保存修改，再打开这位人物的微信。'
                : '点击试聊，项目 Agent 会补齐缺少的历史聊天与朋友圈，再打开这位人物的微信。'}
            </p>
            <button
              type="button"
              disabled={(busy && !allowTrialWhileSaving) || !onStartTrial || saveBlocked}
              onClick={() => {
                onStartTrial?.();
              }}
            >
              {busy ? (allowTrialWhileSaving ? '保存后试聊' : '正在准备试聊…') : '与TA试聊'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
