'use client';

import { useState } from 'react';
import {
  CHARACTER_MODULES,
  characterPreview,
  characterPreviewTime,
  characterModuleText,
  updateCharacterField,
} from './publisher-character-model.ts';
import s from './publisher-character-preview.module.css';

type Props = {
  content: Record<string, unknown>;
  actorKey: string;
  canEdit: boolean;
  busy: boolean;
  onChange: (content: Record<string, unknown>) => void;
};
export function PublisherCharacterPreview({ content, actorKey, canEdit, busy, onChange }: Props) {
  const [view, setView] = useState<'chat' | 'introduction' | 'moments'>('chat');
  const person = characterPreview(content, actorKey);
  if (!person) return <p className={s.empty}>请先核对人物，重复的人物暂不能预览。</p>;
  const name = person.name || '未命名人物';
  const initials = [...name][0];
  const avatar = (
    <span className={s.avatar}>
      {person.avatar ? <img src={person.avatar} alt="" /> : initials}
    </span>
  );
  return (
    <div className={s.character}>
      <section className={s.preview} aria-label={`${name}的手机预览`}>
        <header className={s.header}>
          <button
            className={s.profile}
            type="button"
            onClick={() => setView('introduction')}
            aria-label={`查看${name}的角色介绍`}
          >
            {avatar}
            <span>
              <strong>{name}</strong>
              <small>查看角色介绍</small>
            </span>
          </button>
          <button type="button" className={s.momentsButton} onClick={() => setView('moments')}>
            朋友圈
          </button>
        </header>
        <nav className={s.tabs} aria-label="人物预览内容">
          {(
            [
              ['chat', '聊天'],
              ['introduction', '角色介绍'],
              ['moments', '朋友圈'],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={view === key}
              className={view === key ? s.active : ''}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === 'chat' && (
          <div className={s.chat} aria-label="开场聊天记录">
            {person.messages.length ? (
              person.messages.map((m, index) => (
                <div key={`${m.key}-${index}`}>
                  <div className={s.time}>
                    <time dateTime={m.at}>{characterPreviewTime(m.at)}</time>
                  </div>
                  <div className={`${s.message} ${m.speaker === 'player' ? s.playerMessage : ''}`}>
                    {m.speaker === 'actor' ? avatar : null}
                    <p className={s.bubble}>
                      <span className={s.visuallyHidden}>
                        {m.speaker === 'player' ? '你：' : `${name}：`}
                      </span>
                      {m.text}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className={s.empty}>
                {person.knownAtStart
                  ? '尚未准备开场聊天记录。整理人物后，核对生成的历史对话再发布。'
                  : '开场时你们尚未认识，没有既有聊天记录。'}
              </p>
            )}
          </div>
        )}
        {view === 'introduction' && (
          <div className={s.introduction}>
            {avatar}
            <h3>{name}</h3>
            {person.identity && <p className={s.identity}>{person.identity}</p>}
            <p className={s.publicText}>{person.introduction || '尚未填写给玩家看的角色介绍。'}</p>
          </div>
        )}
        {view === 'moments' && (
          <div className={s.moments} aria-label={`${name}的朋友圈`}>
            <div className={s.momentsCover}>
              {avatar}
              <strong>{name}</strong>
            </div>
            {person.moments.length ? (
              person.moments.map((m, index) => (
                <article className={s.post} key={`${m.key}-${index}`}>
                  {avatar}
                  <div>
                    <strong>{name}</strong>
                    <p>{m.text}</p>
                    <time dateTime={m.at}>{characterPreviewTime(m.at)}</time>
                  </div>
                </article>
              ))
            ) : (
              <p className={s.empty}>
                {person.knownAtStart
                  ? '尚无开场动态。角色可以少发或不发朋友圈。'
                  : '尚未认识这个人物，开场手机中没有他的朋友圈。'}
              </p>
            )}
          </div>
        )}
        <footer className={s.caption}>预览当前草稿中的开场内容；保存后用于试演与发布。</footer>
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
  );
}
