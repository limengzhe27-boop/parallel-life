import { notFound } from 'next/navigation';
import { WorldPhoneSurface } from '../../../features/phone/world-phone-app.tsx';
import { AppViewport } from '../../../components/app-viewport.tsx';
export const dynamic = 'force-dynamic';
export default function Preview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const id = '10000000-0000-4000-8000-000000000001';
  return (
    <div className="world-viewport">
      <AppViewport />
      <WorldPhoneSurface
        preview
        data={{
          id,
          seedId: id,
          version: 1,
          title: '界面测试 · 街角维修铺',
          time: '2026-09-22T00:30:00Z',
          identity: '合成样板：社区维修铺店主',
          setting: '合成样板：清晨，修理铺刚开门。',
          actors: [{ id, name: '测试邻居', relationship: '合成角色' }],
          choices: [
            {
              id: '10000000-0000-4000-8000-000000000002',
              actorId: id,
              quote: '我决定先把短片剪到十五分钟',
              intent: '完成十五分钟版本',
              at: '2026-09-21T20:10:00Z',
              sourceEventId: '10000000-0000-4000-8000-000000000003',
              status: 'followed_up',
              nextStep: {
                quote: '明天一起看初剪？我留一小时。',
                at: '2026-09-22T00:00:00Z',
                sourceEventId: '10000000-0000-4000-8000-000000000005',
                sourceMessageId: '10000000-0000-4000-8000-000000000006',
                calendar: {
                  id: '10000000-0000-4000-8000-000000000007',
                  title: '一起看初剪',
                  at: '2026-09-23T00:00:00.000Z',
                  status: 'confirmed',
                },
              },
              result: {
                kind: 'reported_done',
                quote: '我把短片剪完了，十五分钟版本已经导出',
                at: '2026-09-22T00:20:00Z',
                sourceEventId: '10000000-0000-4000-8000-000000000004',
              },
            },
            {
              id: '10000000-0000-4000-8000-000000000008',
              actorId: id,
              quote: '我决定先把维修铺宣传片剪出一个版本',
              intent: '剪出维修铺宣传片',
              at: '2026-09-22T00:21:00Z',
              sourceEventId: '10000000-0000-4000-8000-000000000009',
              status: 'followed_up',
              result: {
                kind: 'blocked',
                quote: '我剪宣传片卡住了，开头节奏对不上',
                at: '2026-09-22T00:24:00Z',
                sourceEventId: '10000000-0000-4000-8000-000000000010',
              },
              recoveryStep: {
                quote: '我可以帮你看前三分钟，先找能剪掉的镜头',
                at: '2026-09-22T00:27:00Z',
                sourceEventId: '10000000-0000-4000-8000-000000000011',
                sourceMessageId: '10000000-0000-4000-8000-000000000012',
              },
            },
          ],
          invitations: [
            {
              id: '10000000-0000-4000-8000-000000000007',
              title: '一起看初剪',
              at: '2026-09-23T00:00:00.000Z',
              participantIds: [id],
              status: 'confirmed',
            },
          ],
          messages: [
            {
              id: 'fixture-message',
              actorId: id,
              text: '界面测试：车胎有点漏气，可以帮我看看吗？',
              at: '2026-09-22T00:30:00Z',
            },
          ],
          notes: [
            {
              id: `${id}:opening-note:0`,
              title: '合成样板记录',
              text: '检查工具，整理工作台。',
              version: 0,
              updatedAt: '2026-09-22T00:30:00Z',
            },
          ],
        }}
      />
    </div>
  );
}
