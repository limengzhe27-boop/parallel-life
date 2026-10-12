'use client';
import { useEffect, useRef, useState } from 'react';
import { LifeClient } from '../api/client.ts';
import { PublishedCatalog } from './published-catalog.tsx';
import {
  PublicationPlayerCatalogSchema,
  PublicationWorldResultSchema,
  type PublicationPlayerCatalog,
} from '../../contracts/publication-worlds.ts';
import { AppViewport } from '../../components/app-viewport.tsx';
export function PublicationController() {
  const [client] = useState(() => new LifeClient());
  const [catalog, setCatalog] = useState<PublicationPlayerCatalog | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [starting, setStarting] = useState<string | null>(null);
  const running = useRef(false),
    pending = useRef(new Map<string, string>());
  async function read(cursor?: string) {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    setError(null);
    try {
      await client.connect();
      const r = await fetch(
        '/api/v1/publications' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
        { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) },
      );
      if (!r.ok) throw Error('load');
      const data = PublicationPlayerCatalogSchema.parse(await r.json());
      setCatalog((old) =>
        cursor && old
          ? {
              works: [
                ...old.works,
                ...data.works.filter((c) => !old.works.some((o) => o.id === c.id)),
              ],
              nextCursor: data.nextCursor,
            }
          : data,
      );
    } catch {
      setError('暂时无法读取已发布的世界，请稍后重新打开。');
    } finally {
      running.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void read();
  }, [client]);
  async function start(card: PublicationPlayerCatalog['works'][number]) {
    if (running.current) return;
    if (card.worldId) {
      window.location.assign('/worlds/' + card.worldId);
      return;
    }
    running.current = true;
    setStarting(card.id);
    setError(null);
    try {
      await client.connect();
      const key = card.id + ':' + card.version;
      let commandId = pending.current.get(key);
      if (!commandId) {
        commandId = crypto.randomUUID();
        pending.current.set(key, commandId);
      }
      const s = await fetch('/api/v1/session', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!s.ok) throw Error('session');
      const state = await s.json();
      const r = await fetch('/api/v1/publications/' + card.id + '/start', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken },
        body: JSON.stringify({ commandId, publicationVersion: card.version }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        if (r.status < 500) pending.current.delete(key);
        throw Error('start');
      }
      const result = PublicationWorldResultSchema.parse(await r.json());
      if (
        result.origin.workId !== card.id ||
        result.origin.publicationVersion !== card.version ||
        result.originKind !== 'published_work'
      )
        throw Error('origin');
      pending.current.delete(key);
      window.location.assign('/worlds/' + result.worldId);
    } catch {
      setError('这次还没能打开，请再试一次。已有进度会保留，不会从头创建。');
    } finally {
      running.current = false;
      setStarting(null);
    }
  }
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0a1628',
        color: '#eaf1ff',
        maxWidth: 520,
        margin: '0 auto',
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      <AppViewport />
      <a
        href="/possibilities"
        style={{ color: '#adcaff', display: 'inline-block', padding: '12px 0' }}
      >
        ‹ 返回分支
      </a>
      <PublishedCatalog
        catalog={catalog}
        loading={loading}
        error={error}
        startingWorkId={starting}
        onStart={(card) => void start(card)}
        onReload={() => void read()}
        onNext={catalog?.nextCursor ? () => void read(catalog.nextCursor!) : undefined}
      />
    </div>
  );
}
