'use client';
import { useState } from 'react';
import type { PhoneApp } from './navigation.ts';
import { PhoneAppView } from './apps/index.tsx';
import s from './wechat-character.module.css';

/** Uses the normal phone apps/provider and message receipts; this is only presentation. */
export function WechatCharacter({ actorId }: { actorId?: string }) {
  const [route, setRoute] = useState<{ app: 'messages' | 'moments'; target?: string }>({
    app: 'messages',
    target: actorId,
  });
  const [notice, setNotice] = useState('');
  function open(app: PhoneApp, target?: string) {
    if (app !== 'messages' && app !== 'moments') {
      setNotice('这里先查看聊天和朋友圈。');
      return;
    }
    setNotice('');
    setRoute({ app, ...(target ? { target } : {}) });
  }
  if (!actorId) return <p className={s.empty}>这份试聊中没有这个人物，请保存后重新试聊。</p>;
  return (
    <section className={s.wechat} aria-label="人物微信">
      <nav className={s.tabs} aria-label="微信内容">
        <button
          type="button"
          aria-pressed={route.app === 'messages'}
          onClick={() => open('messages', actorId)}
        >
          聊天
        </button>
        <button
          type="button"
          aria-pressed={route.app === 'moments'}
          onClick={() => open('moments', actorId)}
        >
          TA的朋友圈
        </button>
      </nav>
      {notice && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      <div className={s.content}>
        <PhoneAppView {...route} open={open} />
      </div>
    </section>
  );
}
