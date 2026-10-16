'use client';
import { useState } from 'react';
import { AppViewport } from '../../../components/app-viewport.tsx';
import { PhoneShell, type PhoneNotification } from '../phone-shell.tsx';
import { ScenePanel } from './scene-panel.tsx';
import { SceneReadSchema } from '../../../contracts/scenes.ts';
import { routeHash } from '../navigation.ts';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const worldId = id(1),
  sceneId = id(2),
  ownerId = id(3),
  actorId = id(4);
const base = {
  worldId,
  sceneId,
  ownerId,
  sourceEventId: id(8),
  sourceVersion: 2,
  observableTo: [{ kind: 'player' }],
};
const read = SceneReadSchema.parse({
  worldVersion: 6,
  storyNow: '2026-10-12T11:15:00.000Z',
  paused: false,
  experience: { ownerId, worldId, currentSceneId: sceneId, view: { kind: 'scene', sceneId } },
  scene: {
    ownerId,
    worldId,
    id: sceneId,
    sourceEventId: id(7),
    sourceVersion: 1,
    title: '晚饭前',
    placeId: 'lin_home',
    status: 'active',
    presence: [
      { participant: { kind: 'player' }, sourceEventId: id(7), sourceVersion: 1, joinedVersion: 1 },
      {
        participant: { kind: 'actor', actorId },
        sourceEventId: id(7),
        sourceVersion: 1,
        joinedVersion: 1,
      },
    ],
  },
  entries: [
    {
      ...base,
      id: id(9),
      kind: 'time_place',
      location: '林悦家 · 客厅',
      storyAt: '2026-10-12T11:15:00.000Z',
    },
    {
      ...base,
      id: id(10),
      kind: 'narration',
      perspective: 'observable',
      text: '厨房的水声停了。餐桌上已经摆好了碗筷，窗边的灯刚亮起来。',
    },
    {
      ...base,
      id: id(11),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId },
      text: '先坐吧，我给你留了位置。',
    },
    {
      ...base,
      id: id(12),
      kind: 'narration',
      perspective: 'observable',
      text: '门外传来脚步声，林悦回头看了一眼。',
    },
  ],
  actions: [],
  matters: [],
  task: null,
});
const transport: typeof fetch = async (input, init) => {
  const path = String(input);
  if (path === '/api/v1/session')
    return Response.json({ kind: 'guest', csrfToken: 'explicit-ui-fixture-not-a-session-key' });
  if (path.includes('/scenes') && (!init?.method || init.method === 'GET'))
    return Response.json(read);
  return Response.json(
    { error: { code: 'UNAVAILABLE', message: '界面验收样例不执行剧情。' } },
    { status: 503 },
  );
};
/** Synthetic fixture only. Server page rejects production, no API/DB/model is called. */
export function SceneStagePreview() {
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  return (
    <div className="world-viewport">
      <AppViewport />
      <PhoneShell
        worldId={worldId}
        lifeName="现场界面验收样例"
        dateLabel="10月12日"
        timeLabel="19:15"
        initiallyLocked={false}
        notice={
          <span>
            界面验收样例 ·{' '}
            <button
              onClick={() =>
                setNotifications((old) => [
                  ...old,
                  {
                    id: 'preview-' + old.length,
                    title: '阿杰',
                    summary: '师傅又问你了，今晚车间的事还谈不谈？',
                    app: 'messages',
                    target: actorId,
                    timeLabel: '刚刚',
                  },
                ])
              }
            >
              模拟微信来信
            </button>
          </span>
        }
        notifications={notifications}
        renderHome={() => (
          <button
            onClick={() => {
              window.location.hash = routeHash(worldId, {
                app: null,
                panel: 'scene',
                target: sceneId,
              });
            }}
          >
            查看现场样例
          </button>
        )}
        renderApp={() => (
          <div style={{ padding: 20 }}>
            微信来信界面样例
            <button
              onClick={() => {
                window.location.hash = routeHash(worldId, {
                  app: null,
                  panel: 'scene',
                  target: sceneId,
                });
              }}
            >
              返回现场
            </button>
          </div>
        )}
        renderPanel={() => (
          <ScenePanel
            worldId={worldId}
            transport={transport}
            contacts={[
              {
                id: actorId,
                name: '林悦',
                relationship: '合成人物样例',
                avatarUrl: '/art/lives/avatar-rose.svg',
                unread: 0,
              },
            ]}
          />
        )}
      />
    </div>
  );
}
