'use client';

import React, { useState } from 'react';
import { PublisherWorkbench } from '../../../features/publisher/publisher-workbench.tsx';
import type { PublisherWork, PublisherCheckResult } from '../../../contracts/world-publisher.ts';
import type { PublisherWorkbenchDraft } from '../../../contracts/publisher-workbench.ts';

const SAMPLE_WORKS = [
  {
    id: 'work-ipo-001',
    title: '如果，我的公司上市了',
    draftVersion: 3,
    metadataVersion: 1,
    status: 'draft' as const,
    publicationVersion: null,
    createdAt: '2024-05-18T10:00:00Z',
    updatedAt: '2024-05-18T14:30:00Z',
  },
  {
    id: 'work-photo-002',
    title: '如果，我成为了旅行摄影师',
    draftVersion: 1,
    metadataVersion: 1,
    status: 'draft' as const,
    publicationVersion: null,
    createdAt: '2024-05-17T09:00:00Z',
    updatedAt: '2024-05-17T11:20:00Z',
  },
  {
    id: 'work-restart-003',
    title: '如果，人生重来一次',
    draftVersion: 2,
    metadataVersion: 2,
    status: 'published' as const,
    publicationVersion: 1,
    createdAt: '2024-05-10T08:00:00Z',
    updatedAt: '2024-05-16T18:00:00Z',
  },
];

const INITIAL_WORK_IPO: PublisherWork = {
  id: 'work-ipo-001',
  title: '如果，我的公司上市了',
  draftVersion: 3,
  metadataVersion: 1,
  status: 'draft',
  publicationVersion: null,
  createdAt: '2024-05-18T10:00:00Z',
  updatedAt: '2024-05-18T14:30:00Z',
  draft: {
    version: 3,
    contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    createdAt: '2024-05-18T14:30:00Z',
    createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    content: {
      schemaVersion: 1,
      work: {
        key: 'work_ipo',
        title: '如果，我的公司上市了',
        hook: '从敲钟上市到多重利益博弈',
        description: '你经历多年苦拼终于带领公司敲钟上市，但今晚不仅有庆功宴，更有旧人与暗流等待回应。',
        experienceNote: '包含职场与情感多方选择。',
      },
      world: {
        publicSetting: '现代一线大都市，金融与科技企业云集。',
        tone: '现实主义，现代商业与复杂人际。',
        startAt: '2024-05-18T18:00:00Z',
        startPlaceKey: 'place_hotel',
        hiddenContext: '公司上市背后有资本对赌协议尚未完全解除。',
      },
      protagonist: {
        identity: '28岁，上市公司创始人兼CEO',
        situation: '刚从港交所敲钟归来，手握期权但面临各方人际与家庭期待。',
        knownFactKeys: ['fact_ipo_bell'],
      },
      actors: [
        {
          key: 'actor_qingqing',
          name: '青青',
          knownAtStart: true,
          publicCard: {
            identity: '21岁 · 大三学生',
            traits: ['嘴硬心软', '爱开玩笑', '邻家青梅'],
            appearance: '黑色中长发，常穿浅色外套，笑容灵动',
          },
          privatePersona: {
            background: '与主角从小在同一个老家筒子楼长大，两家大人关系密切。看着主角一步步走出老家打拼。',
            voice: '嘴硬心软，爱开玩笑，失落时会装作不在乎。\n说话短，习惯叫你哥，不会直说自己吃醋。',
            motivation: '在乎：被认真对待，不因你的身份变化而变得疏远。\n眼前：今晚和你单独吃一碗以前常吃的面。',
            boundaries: '知道：今天是你公司上市的大日子。\n不知道：庆功宴也在今晚，她还没收到改期消息。\n底线：不接受用钱替代陪伴，拒绝后不会自动答应。',
          },
        },
        {
          key: 'actor_laozhou',
          name: '老周',
          knownAtStart: true,
          publicCard: {
            identity: '41岁 · 前老板，现在是下属',
            traits: ['老练沧桑', '隐忍服从'],
            appearance: '头发微秃，常年穿旧夹克，眼神深邃',
          },
          privatePersona: {
            background: '曾经创办公司雇佣过主角，后来破产被主角反向收购，如今在供应链部门任职。',
            voice: '客气而保留距离，话里有话。习惯称呼您。',
            motivation: '在乎：保全自己在团队里的尊严与家庭开销。\n眼前：今晚在庆功宴上拿回当年承诺的股份证明。',
            boundaries: '知道：主角现在是风头无两的上市公司老板。\n不知道：主角对当年的旧情分是否还认。\n底线：不可当众羞辱。',
          },
        },
        {
          key: 'actor_linbaiyu',
          name: '林白语',
          knownAtStart: true,
          publicCard: {
            identity: '27岁 · 大学同学',
            traits: ['优雅温柔', '高岭之花'],
            appearance: '米白色大衣，淡妆，举止得体',
          },
          privatePersona: {
            background: '大学校花，家族实业背景，曾与主角是同专业同学。',
            voice: '温和平静，带着体面的疏离感与淡淡的调侃。',
            motivation: '在乎：寻找规则之外不受安排的真实生活体验。\n眼前：祝贺你上市，并确认大学时期的旧事你是否还记得。',
            boundaries: '知道：你公司成功敲钟上市。\n不知道：你私下与青青的紧密联络。\n底线：不接受被利用当做商务背景板。',
          },
        },
      ],
      relationships: [
        {
          key: 'rel_qingqing_player',
          from: { kind: 'actor', actorKey: 'actor_qingqing' },
          to: { kind: 'player' },
          description: '从小一起长大的邻家朋友，无血缘关系。',
          visibility: { kind: 'world' },
        },
        {
          key: 'rel_laozhou_player',
          from: { kind: 'actor', actorKey: 'actor_laozhou' },
          to: { kind: 'player' },
          description: '前任老板，如今公司合并后的资深技术顾问。',
          visibility: { kind: 'world' },
        },
        {
          key: 'rel_linbaiyu_player',
          from: { kind: 'actor', actorKey: 'actor_linbaiyu' },
          to: { kind: 'player' },
          description: '大学同专业老同学，多年后重逢。',
          visibility: { kind: 'world' },
        },
      ],
      places: [
        { key: 'place_hotel', name: '君悦酒店宴会厅', description: '庆功宴现场', knownAtStart: true },
        { key: 'place_noodle', name: '老街面馆', description: '以前常去的小店', knownAtStart: true },
      ],
      routes: [{ fromPlaceKey: 'place_hotel', toPlaceKey: 'place_noodle', minutes: 25 }],
      history: [
        {
          key: 'fact_ipo_bell',
          kind: 'established_fact',
          text: '公司今日上午在证券交易所正式敲钟上市。',
          occurredAt: '2024-05-18T09:30:00Z',
          actorKeys: ['actor_laozhou'],
          visibility: { kind: 'world' },
        },
      ],
      initialKnowledge: [
        { actorKey: 'actor_qingqing', factKeys: ['fact_ipo_bell'] },
        { actorKey: 'actor_laozhou', factKeys: ['fact_ipo_bell'] },
        { actorKey: 'actor_linbaiyu', factKeys: ['fact_ipo_bell'] },
      ],
      phone: {
        messages: [
          {
            key: 'msg_qing_01',
            actorKey: 'actor_qingqing',
            origin: 'incoming',
            text: '哥，恭喜敲钟！晚上能一起吃碗面不？',
            at: '2024-05-18T10:15:00Z',
          },
        ],
        notes: [],
        invitations: [],
        album: [],
      },
      media: [],
      candidates: [
        {
          key: 'cand_dinner_clash',
          kind: 'candidate',
          title: '庆功宴与老街面馆的抉择',
          editorialIntent: '在商业成功盛宴与微末旧人之间面临时间与态度的残酷撕裂。',
          actorKeys: ['actor_qingqing', 'actor_laozhou'],
          placeKey: 'place_hotel',
          prerequisites: [{ kind: 'history_fact', factKey: 'fact_ipo_bell' }],
          mutuallyExclusiveNodeKeys: [],
          intent: { kind: 'editorial_only' },
        },
      ],
    },
  },
};

export function PublisherPreviewApp() {
  const [works, setWorks] = useState(SAMPLE_WORKS);
  const [currentWork, setCurrentWork] = useState<PublisherWork | null>(INITIAL_WORK_IPO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [checkResult, setCheckResult] = useState<PublisherCheckResult | null>(null);

  const handleSelectWork = (workId: string) => {
    setError(null);
    if (workId === 'work-ipo-001') {
      setCurrentWork(INITIAL_WORK_IPO);
    } else {
      const summary = works.find((w) => w.id === workId);
      if (!summary) return;
      setCurrentWork({
        ...summary,
        draft: {
          version: summary.draftVersion,
          contentHash: '0000000000000000000000000000000000000000000000000000000000000000',
          createdAt: summary.updatedAt,
          createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          content: {
            schemaVersion: 1,
            work: {
              key: `work_${summary.id}`,
              title: summary.title,
              hook: '体验草稿',
              description: '',
              experienceNote: '',
            },
            world: {
              publicSetting: '',
              tone: '',
              startAt: '2024-05-18T10:00:00Z',
              startPlaceKey: 'place_01',
              hiddenContext: '',
            },
            protagonist: { identity: '', situation: '', knownFactKeys: [] },
            actors: [],
            relationships: [],
            places: [{ key: 'place_01', name: '起点', description: '', knownAtStart: true }],
            routes: [],
            history: [],
            initialKnowledge: [],
            phone: { messages: [], notes: [], invitations: [], album: [] },
            media: [],
            candidates: [],
          },
        },
      });
    }
  };

  const handleCreateWork = (input: PublisherWorkbenchDraft) => {
    const newId = `work-${Date.now().toString(36)}`;
    const newSummary = {
      id: newId,
      title: input.title,
      draftVersion: 1,
      metadataVersion: 1,
      status: 'draft' as const,
      publicationVersion: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setWorks((prev) => [newSummary, ...prev]);
    const fullWork: PublisherWork = {
      ...newSummary,
      draft: {
        version: 1,
        contentHash: 'new-content-hash',
        createdAt: newSummary.createdAt,
        createdBy: 'current-user-uuid',
        content: input.content,
      },
    };
    setCurrentWork(fullWork);
  };

  const handleSaveDraft = (input: PublisherWorkbenchDraft) => {
    if (!currentWork) return;
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      const newVersion = currentWork.draft.version + 1;
      const updatedWork: PublisherWork = {
        ...currentWork,
        title: input.title,
        draftVersion: newVersion,
        updatedAt: new Date().toISOString(),
        draft: {
          ...currentWork.draft,
          version: newVersion,
          content: input.content,
          createdAt: new Date().toISOString(),
        },
      };
      setCurrentWork(updatedWork);
      setWorks((prev) =>
        prev.map((w) =>
          w.id === updatedWork.id
            ? { ...w, title: input.title, draftVersion: newVersion, updatedAt: updatedWork.updatedAt }
            : w,
        ),
      );
    }, 250);
  };

  const handleCheck = () => {
    if (!currentWork) return;
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      const actors = Array.isArray(currentWork.draft.content.actors)
        ? (currentWork.draft.content.actors as unknown[])
        : [];
      if (actors.length < 2) {
        setCheckResult({
          id: 'check-1',
          workId: currentWork.id,
          draftVersion: currentWork.draft.version,
          contentHash: currentWork.draft.contentHash,
          status: 'invalid',
          issues: [{ path: ['actors'], code: 'too_few_actors' }],
          missingCapabilities: [],
          mediaVerified: true,
          trialVerified: false,
          checkedAt: new Date().toISOString(),
        });
      } else {
        setCheckResult({
          id: 'check-1',
          workId: currentWork.id,
          draftVersion: currentWork.draft.version,
          contentHash: currentWork.draft.contentHash,
          status: 'ready',
          issues: [],
          missingCapabilities: [],
          mediaVerified: true,
          trialVerified: true,
          checkedAt: new Date().toISOString(),
        });
      }
    }, 200);
  };

  const handleTrial = () => {
    alert('【试演沙盒】正在根据当前草稿版本生成试玩实例，将在右侧弹出手机模拟器（沙盒预览）！');
  };

  const handlePublish = () => {
    alert('【发布上架】已锁定不可变发布版本，该作品将同步至外部玩家发现目录！');
  };

  const handleLogout = () => {
    alert('【登出】退出当前编辑会话。');
  };

  return (
    <div>
      <div
        style={{
          background: '#e0f2fe',
          color: '#0369a1',
          padding: '8px 16px',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'center',
          borderBottom: '1px solid #bae6fd',
        }}
      >
        开发预览环境（UI Preview）· 仅供本地界面与表单验收 · 生产环境自动 404
      </div>
      <PublisherWorkbench
        session={{ displayName: '小安 (内容编辑)', canEdit: true, canPublish: true }}
        works={works}
        work={currentWork}
        check={checkResult}
        busy={busy}
        error={error}
        onSelectWork={handleSelectWork}
        onCreateWork={handleCreateWork}
        onSaveDraft={handleSaveDraft}
        onCheck={handleCheck}
        onTrial={handleTrial}
        onPublish={handlePublish}
        onLogout={handleLogout}
      />
    </div>
  );
}
