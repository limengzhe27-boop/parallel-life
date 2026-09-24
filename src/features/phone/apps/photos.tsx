import { useMemo, useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhonePhoto } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links } from './common.tsx';
import { dayKey } from './helpers.ts';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
const labels = {
  queued: '等待生成',
  generating: '正在生成',
  ready: '照片暂不可用',
  failed: '生成失败',
  unknown: '生成结果待确认',
};
function PhotoImage({ photo, detail = false }: { photo: PhonePhoto; detail?: boolean }) {
  const [failed, setFailed] = useState(false);
  return photo.status === 'ready' && photo.url && !failed ? (
    <img
      className={detail ? s.fullPhoto : s.thumbnail}
      src={photo.url}
      alt={photo.description || photo.title}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  ) : (
    <div className={detail ? s.photoPlaceholder : s.thumbnailPlaceholder}>
      <span aria-hidden>▧</span>
      <p>{failed ? '照片加载失败' : labels[photo.status]}</p>
    </div>
  );
}
function UploadPhoto() {
  const { actions, operations, run } = usePhoneApps();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; signature: string } | null>(null);
  const [error, setError] = useState('');
  const operation = operations['album-upload'];
  async function upload(selection: { file: File; signature: string }) {
    const receipt = await run('album-upload', selection.signature, (commandId) =>
      actions.uploadPhoto!(selection.file, commandId),
    );
    if (receipt?.status === 'committed') setSelected(null);
  }
  if (!actions.uploadPhoto) return null;
  return (
    <div className={s.inline}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择相册照片"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || operation?.busy) return;
          setError('');
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
            file.size > 4 * 1024 * 1024 ||
            file.size === 0
          ) {
            setError('请选择 4MB 以内的 JPG、PNG 或 WebP 图片。');
            return;
          }
          const selection = { file, signature: crypto.randomUUID() };
          setSelected(selection);
          void upload(selection);
        }}
      />
      <button
        className={s.primary}
        disabled={operation?.busy}
        onClick={() => input.current?.click()}
      >
        {operation?.busy ? '正在保存照片…' : '添加照片'}
      </button>
      {selected && operation?.status === 'failed' && operation.errorCode !== 'INVALID_INPUT' && (
        <button onClick={() => void upload(selected)}>重试上传</button>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <Feedback
        operation={
          operation?.errorCode === 'INVALID_INPUT'
            ? {
                ...operation,
                error: '无法读取这张图片，请重新选择 JPG、PNG 或 WebP 图片（不超过 4MB）。',
              }
            : operation
        }
        success="已存入相册"
      />
    </div>
  );
}
export function PhotosApp({ target, open }: PhoneAppContext) {
  const { data, actions, operations, run, setDraft } = usePhoneApps();
  const [selectedActorFilter, setSelectedActorFilter] = useState<string>('all');

  // 构建与当前人生紧密相连的丰富回忆切片
  const lifeMemories: PhonePhoto[] = useMemo(() => {
    const leadActor = data.contacts[0];
    const secondActor = data.contacts[1];
    const thirdActor = data.contacts[2];

    const memories: PhonePhoto[] = [
      {
        id: 'mem-1',
        title: '佛罗伦萨的雨后',
        date: '2026-05-18T17:30:00Z',
        description:
          '双年展布展结束的那个黄昏，天突然放晴。老廊桥下的水汽还没散去，红砖拱顶间泛着金色的光。沈棠撑着一把透明雨伞走在前面，突然回头看我：“孟哲，看镜头。”阳光透过水珠洒下来，那一刻我突然觉得，所有推翻重来的方案都是值得的。',
        url: '/art/open-door.webp',
        status: 'ready',
        links: leadActor ? [{ app: 'messages', target: leadActor.id, label: `和${leadActor.name}聊聊这张照片` }] : undefined,
      },
      {
        id: 'mem-2',
        title: '初建工作室的深夜',
        date: '2025-11-04T02:15:00Z',
        description:
          '老洋房工作室刚租下来时的那个冬天特别冷。水电还没排完，几张折叠桌拼在一起，我们裹着厚羽绒服挤在阁楼上一遍遍对节点施工图。凌晨两点，沈棠推门进来，手里拎着两盒刚出锅的小馄饨，热气在结霜的玻璃上晕开一团白雾。她说：“别盯图纸了，再看房子也不会自己立起来，先趁热喝口汤。”',
        url: '/art/first-window.webp',
        status: 'ready',
        links: secondActor ? [{ app: 'messages', target: secondActor.id, label: `和${secondActor.name}聊聊这张照片` }] : undefined,
      },
      {
        id: 'mem-3',
        title: '阳台上的第一株迷迭香',
        date: '2026-09-22T08:00:00Z',
        description:
          '搬进新居的第一个周末，在街角花市抱回来的小盆栽。她说阳台朝南光照最好，清晨浇水时能闻到淡淡的松木与草本香气。不知不觉，它已经在这片露台上见证了无数次通宵画图后的清晨日出。',
        url: '/art/first-window.webp',
        status: 'ready',
        links: leadActor ? [{ app: 'messages', target: leadActor.id, label: `和${leadActor.name}聊聊这张照片` }] : undefined,
      },
      {
        id: 'mem-4',
        title: '答辩那天与恩师的长谈',
        date: '2022-06-15T15:40:00Z',
        description:
          '毕业设计模型前，老院长摘下老花镜看了很久，拍了拍我的肩膀：“孟哲，去走你自己的路，别学我，也别学任何人。真正动人的建筑不是炫技，是给人安放情绪的地方。”这句话，我一直记到了今天。',
        url: '/art/open-door.webp',
        status: 'ready',
        links: thirdActor ? [{ app: 'messages', target: thirdActor.id, label: `和${thirdActor.name}聊聊这张照片` }] : undefined,
      },
    ];

    // 如果用户上传了新照片，优先放在最前面
    const userPhotos = (data.photos ?? []).filter((p) => p.status === 'ready');
    return [...userPhotos, ...memories];
  }, [data.contacts, data.photos]);

  const filteredPhotos = useMemo(() => {
    if (selectedActorFilter === 'all') return lifeMemories;
    const actor = data.contacts.find((c) => c.id === selectedActorFilter);
    if (!actor) return lifeMemories;
    return lifeMemories.filter((p) => p.description.includes(actor.name) || p.title.includes(actor.name));
  }, [lifeMemories, selectedActorFilter, data.contacts]);

  const photo = lifeMemories.find((p) => p.id === target);

  if (target && !photo)
    return <Empty title="找不到这张照片" text="照片可能已移除，请返回相册或刷新。" />;

  if (photo) {
    const index = lifeMemories.findIndex((p) => p.id === photo.id);
    const relatedContact = data.contacts.find((c) => photo.description.includes(c.name)) ?? data.contacts[0];

    return (
      <div className={`${s.app} ${s.photoDetail}`}>
        {/* 顶部 iOS 原生相册返回导航 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid #f1f5f9',
            background: '#ffffff',
            minHeight: '44px',
            margin: '-12px -12px 12px -12px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              playTapSound();
              open('photos');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              background: 'none',
              border: 'none',
              color: '#0284c7',
              fontSize: '15px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>‹</span>
            <span>图库</span>
          </button>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
            {index + 1} / {lifeMemories.length}
          </span>
          <div style={{ width: '40px' }} />
        </div>
        <div className={s.photoHeading}>
          <time>{dayKey(photo.date)}</time>
          <h3>{photo.title}</h3>
        </div>
        <PhotoImage key={`${photo.id}:${photo.url}`} photo={photo} detail />
        
        <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', margin: '8px 0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
            📖 生活回忆故事
          </div>
          <p className={s.photoDescription} style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.7, color: '#334155' }}>
            {photo.description}
          </p>
        </div>

        {/* 底部前后翻页与设为壁纸操作 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            margin: '8px 0',
          }}
        >
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => {
              playTapSound();
              const prev = lifeMemories[index - 1];
              if (prev) open('photos', prev.id);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '13px',
              cursor: index <= 0 ? 'not-allowed' : 'pointer',
              opacity: index <= 0 ? 0.4 : 1,
            }}
          >
            ‹ 上一张
          </button>

          {photo.url && (
            <button
              type="button"
              onClick={() => {
                playTapSound();
                try {
                  const match = location.hash.match(/life=([^&]+)/);
                  const wid = match ? match[1] : '';
                  if (wid && photo.url) {
                    localStorage.setItem(`pl_wallpaper_${wid}`, photo.url);
                    window.dispatchEvent(new Event('storage'));
                  }
                } catch {}
                alert('已将当前照片设为这台平行手机的桌面壁纸！回到桌面即可查看。');
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#f1f5f9',
                color: '#0f172a',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🖼️ 设为手机壁纸
            </button>
          )}

          <button
            type="button"
            disabled={index >= lifeMemories.length - 1}
            onClick={() => {
              playTapSound();
              const next = lifeMemories[index + 1];
              if (next) open('photos', next.id);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '13px',
              cursor: index >= lifeMemories.length - 1 ? 'not-allowed' : 'pointer',
              opacity: index >= lifeMemories.length - 1 ? 0.4 : 1,
            }}
          >
            下一张 ›
          </button>
        </div>

        <div className={s.inline}>
          {(photo.status === 'failed' || photo.status === 'unknown') && (
            <>
              <p>
                {photo.status === 'unknown'
                  ? '上次生成结果尚未确认。请先刷新核对，确认重试可能再次发起生成。'
                  : '这张照片没能生成，可以再试一次。'}
              </p>
              <button
                className={s.primary}
                disabled={
                  !actions.retryPhoto ||
                  operations[`photo:${photo.id}`]?.busy ||
                  operations[`photo:${photo.id}`]?.status === 'accepted'
                }
                onClick={() =>
                  void run(`photo:${photo.id}`, photo.id, (id) => actions.retryPhoto!(photo.id, id))
                }
              >
                {photo.status === 'unknown' ? '确认重试生成' : '重新生成'}
              </button>
            </>
          )}
          <Feedback
            operation={operations[`photo:${photo.id}`]}
            success="重试已完成，请查看照片状态"
          />
        </div>

        {relatedContact && (
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                background: '#07c160',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(7,193,96,0.2)',
              }}
              onClick={() => {
                const topic = `我刚在相册翻到了《${photo.title}》那张照片，想起当时：${photo.description.slice(0, 30)}…`;
                setDraft(`message:${relatedContact.id}`, topic);
                open('messages', relatedContact.id);
              }}
            >
              💬 把这段回忆发给 {relatedContact.name} 聊聊 →
            </button>
          </div>
        )}

        <div className={s.photoNav}>
          <button disabled={index === 0} onClick={() => open('photos', lifeMemories[index - 1]!.id)}>
            上一张
          </button>
          <span>
            {index + 1} / {lifeMemories.length}
          </span>
          <button
            disabled={index === lifeMemories.length - 1}
            onClick={() => open('photos', lifeMemories[index + 1]!.id)}
          >
            下一张
          </button>
        </div>
      </div>
    );
  }

  const days = [...new Set(filteredPhotos.map((p) => dayKey(p.date)))];

  return (
    <div className={s.app} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff' }}>
      {/* 顶部 iOS 原生图库导航栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #f1f5f9',
          background: '#ffffff',
          minHeight: '44px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: '#0f172a' }}>图库</h2>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            全部照片 · {filteredPhotos.length} 张回忆
          </span>
        </div>
        <UploadPhoto />
      </div>

      {/* 人物筛选胶囊（对齐 Screen 05） */}
      {data.contacts.length > 0 && (
        <div
          style={{
            margin: '4px 12px 10px',
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
            scrollbarWidth: 'none',
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedActorFilter('all')}
            style={{
              padding: '5px 12px',
              borderRadius: '16px',
              fontSize: '12px',
              fontWeight: 500,
              border: selectedActorFilter === 'all' ? '1px solid #0284c7' : '1px solid #e2e8f0',
              background: selectedActorFilter === 'all' ? '#e0f2fe' : '#ffffff',
              color: selectedActorFilter === 'all' ? '#0369a1' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            全部回忆 ({lifeMemories.length})
          </button>
          {data.contacts.map((c) => {
            const count = lifeMemories.filter((p) => p.description.includes(c.name) || p.title.includes(c.name)).length;
            const isSelected = selectedActorFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedActorFilter(c.id)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  border: isSelected ? '1px solid #0284c7' : '1px solid #e2e8f0',
                  background: isSelected ? '#e0f2fe' : '#ffffff',
                  color: isSelected ? '#0369a1' : '#475569',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.name} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
      )}

      {/* 生活胶卷网格 */}
      <div style={{ padding: '0 12px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {filteredPhotos.map((p) => (
            <div
              key={p.id}
              onClick={() => open('photos', p.id)}
              style={{
                borderRadius: '12px',
                overflow: 'hidden',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ width: '100%', height: '118px', overflow: 'hidden', background: '#f1f5f9' }}>
                <img
                  src={p.url || '/art/first-window.webp'}
                  alt={p.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
              <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>
                    {p.title}
                  </strong>
                  <p style={{ fontSize: '11px', color: '#64748b', margin: '3px 0 0', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.description}
                  </p>
                </div>
                <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8' }}>
                  {p.date.slice(0, 10)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
