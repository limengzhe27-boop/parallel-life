'use client';
import { useState } from 'react';
import type { SceneRead } from '../../../contracts/scenes.ts';
import type { PhoneContact, PhonePhoto } from '../apps/types.ts';
import { sceneOverview } from './index-state.ts';
import { sceneArtwork } from './stage-presentation.ts';
import s from './stage.module.css';
export function SceneFace({ person }: { person?: PhoneContact }) {
  const [failed, setFailed] = useState<string>();
  return (
    <span className={s.face} aria-hidden="true">
      {person?.avatarUrl && failed !== person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" onError={() => setFailed(person.avatarUrl)} />
      ) : (
        <span>{person?.name.slice(0, 1) ?? '人'}</span>
      )}
    </span>
  );
}
export function SceneStage({
  read,
  contacts,
  photos = [],
  onSelectPerson,
}: {
  read: SceneRead;
  contacts: readonly PhoneContact[];
  photos?: readonly PhonePhoto[];
  onSelectPerson?: (person: PhoneContact) => void;
}) {
  const art = sceneArtwork(read, photos);
  const [failed, setFailed] = useState<string>();
  const fallback = art.illustration || failed === art.url;
  const people = sceneOverview(read).people;
  const actors = people.filter((participant) => participant.kind === 'actor');
  return (
    <section className={s.stage} aria-label="现场画面" data-scene-stage>
      <div className={s.picture}>
        <img
          src={fallback ? art.fallbackUrl : art.url}
          alt={
            fallback
              ? '原创场地示意，非现场生成照片'
              : art.authored
                ? '场景配图'
                : '已保存的现场画面'
          }
          onError={() => {
            if (!fallback) setFailed(art.url);
          }}
        />
        <div className={s.shade} />
        <span className={s.imageLabel}>
          {fallback ? '场景示意' : art.authored ? '场景配图' : '场景画面'}
        </span>
        <div className={s.caption}>
          <small>{read.scene?.title}</small>
          <h3>{art.location}</h3>
        </div>
      </div>
      <div className={s.people} aria-label="在场人物">
        {actors.length ? (
          actors.map((participant) => {
            const person = contacts.find((contact) => contact.id === participant.actorId);
            return (
              <details key={participant.actorId} className={s.person}>
                <summary>
                  <SceneFace person={person} />
                  <span>{person?.name ?? '在场的人'}</span>
                </summary>
                <div className={s.personInfo}>
                  <strong>{person?.name ?? '在场的人'}</strong>
                  {person?.relationship ? <small>{person.relationship}</small> : null}
                  {person?.summary ? <p>{person.summary}</p> : <p>暂无更多公开介绍。</p>}
                  {person && onSelectPerson ? (
                    <button
                      type="button"
                      className={s.speakBtn}
                      onClick={() => onSelectPerson(person)}
                    >
                      💬 找{person.name}搭话
                    </button>
                  ) : null}
                </div>
              </details>
            );
          })
        ) : (
          <p className={s.empty}>此时周围暂无其他人</p>
        )}
      </div>
    </section>
  );
}
export function SceneMedia({ url, reference }: { url?: string; reference: boolean }) {
  const [failed, setFailed] = useState<string>();
  return (
    <figure className={s.media}>
      {failed === url || !url ? (
        <p>这张图片暂时无法查看。</p>
      ) : (
        <img
          src={url}
          loading="lazy"
          alt={reference ? '现场参考图片' : '已保存的现场图片'}
          onError={() => setFailed(url)}
        />
      )}
      <figcaption>{reference ? '参考图片' : '现场画面'}</figcaption>
    </figure>
  );
}
