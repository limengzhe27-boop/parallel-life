'use client';
import { useEffect, useRef } from 'react';
import { PhoneShell } from './phone-shell.tsx';
import wallpaper from './assets/pfeiffer-beach.jpg';
import styles from './phone.module.css';
import preview from './preview.module.css';

/** Explicit fixtures, gated by the server page. No product route imports this wrapper. */
export function PhonePreview() {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const resize = () =>
      viewport.current?.style.setProperty(
        '--preview-height',
        `${window.visualViewport?.height ?? innerHeight}px`,
      );
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  return (
    <div ref={viewport} className={preview.preview} data-preview-viewport>
      <PhoneShell
        worldId="h01-preview"
        lifeName="另一种日常"
        dateLabel="9 月 22 日 · 星期二"
        timeLabel="08:30"
        wallpaperUrl={wallpaper.src}
        notice={
          <span className={preview.caption}>
            界面样板 · 通用壁纸 / 测试内容
            <a href="https://unsplash.com/photos/p3OzJuT_Dks" target="_blank" rel="noreferrer">
              摄影 Kace Rodriguez
            </a>
          </span>
        }
        notifications={[
          {
            id: 'preview-notice',
            title: '一条待查看的消息',
            summary: '测试通知 · 打开记录 24',
            app: 'messages',
            target: 'record-24',
          },
        ]}
        renderApp={({ app, target, open }) =>
          app === 'messages' ? (
            target ? (
              <section className={styles.empty}>
                <h3>{target === 'record-24' ? '测试记录 24' : '测试记录详情'}</h3>
                <p>这里只验证导航，真实人物消息尚未接入。</p>
              </section>
            ) : (
              <div className={styles.fixtureList}>
                {Array.from({ length: 30 }, (_, i) => (
                  <button
                    key={i}
                    className={styles.fixtureRow}
                    onClick={() => open('messages', `record-${i + 1}`)}
                  >
                    测试记录 {i + 1}
                    <small>滚动与返回验收用内容</small>
                  </button>
                ))}
              </div>
            )
          ) : (
            <section className={styles.empty}>
              <h3>应用还未开放</h3>
              <p>真实内容将在世界准备好后接入。</p>
            </section>
          )
        }
        renderPanel={(panel) => (
          <div className={styles.fixturePanel}>
            <p>
              辅助页样板 · 真实
              {panel === 'schedule' ? '日程' : panel === 'timeline' ? '人生轨迹' : '导演'}尚未接入。
            </p>
            {Array.from({ length: 12 }, (_, i) => (
              <p key={i}>
                测试段落 {i + 1}：用于检查辅助内容始终留在手机内，长内容可滚动，返回能恢复阅读位置。
              </p>
            ))}
          </div>
        )}
      />
    </div>
  );
}
