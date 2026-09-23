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
          title: '界面测试 · 街角维修铺',
          time: '2026-09-22T00:30:00Z',
          identity: '合成样板：社区维修铺店主',
          setting: '合成样板：清晨，修理铺刚开门。',
          actors: [{ id, name: '测试邻居', relationship: '合成角色' }],
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
