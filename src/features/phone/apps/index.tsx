'use client';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { MessagesApp } from './messages.tsx';
import { PhotosApp } from './photos.tsx';
import { CalendarApp } from './calendar.tsx';
import { NotesApp } from './notes.tsx';
import { Empty, Refresh } from './common.tsx';
import s from './apps.module.css';
export { PhoneAppsProvider } from './provider.tsx';
export type { PhoneAppsProviderProps } from './provider.tsx';
export type * from './types.ts';
export function PhoneAppView(context: PhoneAppContext) {
  const { data, loading, loadError } = usePhoneApps();
  const hasData = Object.values(data).some((rows) => rows.length > 0);
  return (
    <div className={s.surface} data-phone-app={context.app}>
      {(loading || Boolean(loadError)) && (
        <div className={s.syncBar}>
          {loading ? (
            <span role="status">正在更新…</span>
          ) : (
            <span role="alert">{loadError}</span>
          )}
          <Refresh />
        </div>
      )}
      {loading && !hasData ? (
        <Empty title="正在打开…" />
      ) : loadError && !hasData ? (
        <Empty title="暂时没能打开" text="请刷新再试。" />
      ) : context.app === 'messages' ? (
        <MessagesApp {...context} />
      ) : context.app === 'photos' ? (
        <PhotosApp {...context} />
      ) : context.app === 'calendar' ? (
        <CalendarApp {...context} />
      ) : context.app === 'notes' ? (
        <NotesApp {...context} />
      ) : (
        <Empty title="这个应用尚未开放" />
      )}
    </div>
  );
}
