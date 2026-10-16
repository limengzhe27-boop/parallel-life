'use client';
import { useState, type ReactNode } from 'react';
import type { PhoneContact } from './types.ts';
import { avatarPresentation } from '../avatar-art.ts';
import s from './person-card.module.css';

export function PersonPicture({
  contact,
  large = false,
}: {
  contact: PhoneContact;
  large?: boolean;
}) {
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set());
  const art = avatarPresentation(contact, failedUrls);
  return (
    <figure className={large ? s.largePicture : s.picture}>
      <div className={s.image}>
        {art.url ? (
          <img
            src={art.url}
            alt={`${contact.name}的形象 · ${art.label}`}
            onError={() => {
              const failed = art.url!;
              setFailedUrls((previous) => new Set([...previous, failed]));
            }}
          />
        ) : (
          <span aria-label={`${contact.name}的姓名标记`}>{contact.name.slice(0, 1)}</span>
        )}
      </div>
      <figcaption>{art.label}</figcaption>
    </figure>
  );
}

/** Only the authorized contact view is accepted. Missing biography stays missing. */
export function PersonCard({
  contact,
  onClose,
  children,
}: {
  contact: PhoneContact;
  onClose?: () => void;
  children?: ReactNode;
}) {
  return (
    <section className={s.card} aria-label={`${contact.name}的人物名片`}>
      <header className={s.header}>
        <div className={s.identity}>
          <PersonPicture key={contact.avatarUrl ?? 'no-image'} contact={contact} />
          <div className={s.name}>
            <h3>{contact.name}</h3>
            {contact.relationship.trim() && <p>{contact.relationship}</p>}
          </div>
        </div>
        {onClose && (
          <button className={s.close} type="button" aria-label="关闭名片" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      <details className={s.portrait}>
        <summary>查看形象</summary>
        <PersonPicture key={contact.avatarUrl ?? 'no-image'} contact={contact} large />
      </details>
      {contact.publicProfile &&
        (contact.publicProfile.identity?.trim() ||
          (contact.publicProfile.traits && contact.publicProfile.traits.length > 0) ||
          contact.publicProfile.appearance?.trim()) && (
          <div className={s.profileDetails}>
            {contact.publicProfile.identity?.trim() && (
              <div className={s.profileRow}>
                <span className={s.fieldLabel}>身份</span>
                <span className={s.fieldValue}>{contact.publicProfile.identity}</span>
              </div>
            )}
            {contact.publicProfile.traits && contact.publicProfile.traits.length > 0 && (
              <div className={s.profileRow}>
                <span className={s.fieldLabel}>性格</span>
                <div className={s.traitsList}>
                  {contact.publicProfile.traits.map((trait, index) => (
                    <span key={index} className={s.traitTag}>
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {contact.publicProfile.appearance?.trim() && (
              <div className={s.profileRow}>
                <span className={s.fieldLabel}>形象</span>
                <span className={s.fieldValue}>{contact.publicProfile.appearance}</span>
              </div>
            )}
          </div>
        )}
      {contact.summary?.trim() && (
        <details className={s.about}>
          <summary>人物介绍</summary>
          <p>{contact.summary}</p>
        </details>
      )}
      {children && <div className={s.actions}>{children}</div>}
    </section>
  );
}
