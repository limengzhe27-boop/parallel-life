'use client';
import { useEffect, useMemo, useState } from 'react';
import { AppViewport } from '../../../components/app-viewport.tsx';
import { PhoneShell, type PhoneNotification } from '../phone-shell.tsx';
import { ScenePanel } from './scene-panel.tsx';
import { SceneReadSchema } from '../../../contracts/scenes.ts';
import { routeHash } from '../navigation.ts';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const worldId = id(1),
  sceneId = id(2),
  ownerId = id(3),
  actorId = id(4),
  otherActorId = id(5);
const base = {
  worldId,
  sceneId,
  ownerId,
  sourceEventId: id(8),
  sourceVersion: 2,
  observableTo: [{ kind: 'player' }],
};
const initialRead = SceneReadSchema.parse({
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
    title: '晚饭前 · 界面样例',
    placeId: 'lin_home',
    status: 'active',
    presence: [
      { participant: { kind: 'player' }, sourceEventId: id(7), sourceVersion: 1, joinedVersion: 1 },
      ...[actorId, otherActorId].map((actorId) => ({
        participant: { kind: 'actor', actorId },
        sourceEventId: id(7),
        sourceVersion: 1,
        joinedVersion: 1,
      })),
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
      text: '厨房的水声停了。窗边的灯刚亮起来。',
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
      text: '林悦把围裙搭在椅背上，转身将窗户关小了一些。楼下传来自行车的铃声，随后又被细密的雨声盖住。她看向桌上的两副碗筷，停了片刻，才把第三副也摆到你面前。\n\n陈宁将带来的纸袋放在门边，低头擦去外套上的水滴。她没有立刻加入谈话，而是走到窗边，把被风吹乱的窗帘整理好。桌上那盏暖黄色的小灯照着热水杯，玻璃上凝出一层薄薄的水汽。\n\n厨房里还留着刚煮好饭菜的香气。林悦端着汤碗出来，陈宁随手移开了挡在桌边的椅子，两人的动作碰巧接在一起，又各自笑了一下。你能听见汤勺轻碰瓷碗的声音。她们没有催促，只是等你放下手里的东西。',
    },
    {
      ...base,
      id: id(13),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId: otherActorId },
      text: '外面雨不小，路上还顺利吗？',
    },
    {
      ...base,
      id: id(14),
      kind: 'dialogue',
      speaker: { kind: 'player' },
      text: '还好，刚好赶上最后一班车。',
    },
    {
      ...base,
      id: id(15),
      kind: 'user_action',
      actionId: id(30),
      text: '我把背包放到椅子旁，给大家倒水。',
    },
    {
      ...base,
      id: id(16),
      kind: 'adjudicated_result',
      actionId: id(30),
      outcome: 'succeeded',
      text: '三只杯子都倒好了水，背包留在你的椅子旁。',
    },
    {
      ...base,
      id: id(17),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId },
      text: '菜还热着，先吃饭，路上的事慢慢说。',
    },
    {
      ...base,
      id: id(18),
      kind: 'narration',
      perspective: 'observable',
      text: '陈宁侧身让出座位，顺手把菜单往你这边推了推。',
    },
    {
      ...base,
      id: id(19),
      kind: 'dialogue',
      speaker: { kind: 'player' },
      text: '你们今天都忙了些什么？',
    },
    {
      ...base,
      id: id(20),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId: otherActorId },
      text: '我下午去了趟旧书店，挑了本有意思的游记。',
    },
    {
      ...base,
      id: id(21),
      kind: 'dialogue',
      speaker: { kind: 'actor', actorId },
      text: '我把上次那道汤又试了一遍，这次没放那么多盐。',
    },
  ],
  actions: [
    {
      worldId,
      sceneId,
      ownerId,
      id: id(30),
      commandId: id(31),
      sourceEventId: id(8),
      sourceVersion: 2,
      intent: 'attempt',
      kind: 'operate',
      text: '我把背包放到椅子旁，给大家倒水。',
      relatedMatterIds: [],
      status: 'resolved',
      resolution: {
        sourceEventId: id(8),
        sourceVersion: 2,
        outcome: 'succeeded',
        observation: '三只杯子都倒好了水，背包留在你的椅子旁。',
      },
    },
  ],
  matters: [],
  task: null,
});
/** Synthetic UI fixture only. Production rejects this page; no API/DB/model is called. */
export function SceneStagePreview() {
  const [read, setRead] = useState(initialRead);
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const transport = useMemo<typeof fetch>(
    () => async (input, init) => {
      const path = String(input);
      if (path === '/api/v1/session')
        return Response.json({ kind: 'guest', csrfToken: 'explicit-ui-fixture-not-a-session-key' });
      if (path.includes('/scenes') && (!init?.method || init.method === 'GET'))
        return Response.json(read);
      return Response.json(
        { error: { code: 'UNAVAILABLE', message: '界面验收样例不执行剧情、不保存行动。' } },
        { status: 503 },
      );
    },
    [read],
  );
  useEffect(() => {
    if (!window.location.hash)
      window.location.hash = routeHash(worldId, { app: null, panel: 'scene', target: sceneId });
  }, []);
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
            界面样例 · 非真实剧情{' '}
            <button
              type="button"
              onClick={() =>
                setRead((current) => {
                  const version = current.worldVersion + 1;
                  return SceneReadSchema.parse({
                    ...current,
                    worldVersion: version,
                    entries: [
                      ...current.entries,
                      {
                        ...base,
                        id: id(1000 + version),
                        sourceEventId: id(2000 + version),
                        sourceVersion: version,
                        kind: 'dialogue',
                        speaker: { kind: 'actor', actorId: version % 2 ? actorId : otherActorId },
                        text: `新增界面样例 ${version - initialRead.worldVersion}：这条记录只用于检查阅读历史时是否保持位置。`,
                      },
                    ],
                  });
                })
              }
            >
              模拟现场新消息
            </button>{' '}
            <button
              type="button"
              onClick={() =>
                setNotifications((old) => [
                  ...old,
                  {
                    id: 'preview-' + old.length,
                    title: '阿杰',
                    summary: '这是模拟的场外微信来信，不是现场对白。',
                    app: 'messages',
                    target: id(6),
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
              {
                id: otherActorId,
                name: '陈宁',
                relationship: '合成人物样例',
                avatarUrl: '/art/lives/avatar-amber.svg',
                unread: 0,
              },
            ]}
          />
        )}
      />
    </div>
  );
}
