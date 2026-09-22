'use client';
import { useEffect, useState } from 'react';
import type { Discovery } from '../../contracts/discovery.ts';
import type { LifeClient } from '../api/client.ts';
import { Button, Icon } from '../../components/ui.tsx';
/** A persisted proposal belongs to the personal conversation, not a public feed. */
export function ProposalThread({
  client,
  revision,
  ready,
  profileVersion,
}: {
  client: LifeClient;
  revision: number;
  ready: boolean;
  profileVersion: number;
}) {
  const [data, setData] = useState<Discovery | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    client
      .discovery()
      .then((d) => {
        if (live) {
          setData(d);
          setFailed(false);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [client, revision]);
  if (!ready && !data?.directions.length) return null;
  return (
    <section className="proposal-thread" aria-label="对话中的人生提案">
      <div className="proposal-thread-label">
        <Icon name="spark" size={17} />
        <span>我们聊出的另一种可能</span>
      </div>
      {data?.directions.length ? (
        <>
          {data.profileVersion !== profileVersion && (
            <p className="proposal-stale">这是此前聊出的想法。你的资料有了变化，可以再调整。</p>
          )}
          {data.directions.map((d, i) => (
            <a
              key={d.id}
              className="proposal-thread-card"
              href={`/possibilities?direction=${d.id}`}
            >
              <img
                src={i === 1 ? '/art/open-door.webp' : '/art/meadow-door.webp'}
                alt="通用想象插画"
              />
              <div>
                <small>人生提案 · {i + 1}</small>
                <h3>{d.title}</h3>
                <span>
                  聊聊这段人生 <Icon name="chevron" size={14} />
                </span>
              </div>
            </a>
          ))}
          <a className="proposal-more" href="/possibilities">
            还有别的想法？继续调整 <Icon name="edit" size={14} />
          </a>
        </>
      ) : (
        <div className="proposal-invitation">
          <p>
            {failed
              ? '之前的提案暂时没能打开。可以进入详情再试一次。'
              : '如果换一个选择，你想看看生活会怎样吗？'}
          </p>
          <a className="button secondary" href="/possibilities">
            {failed ? '打开人生提案' : '一起想想'}
            <Icon name="arrow" size={16} />
          </a>
        </div>
      )}
    </section>
  );
}
