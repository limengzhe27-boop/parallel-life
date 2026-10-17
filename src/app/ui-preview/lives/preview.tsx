'use client';
import { useState } from 'react';
import { AppViewport } from '../../../components/app-viewport.tsx';
import { AppTabs } from '../../../components/app-tabs.tsx';
import { OfficialLivesView, type OfficialLifeCardView } from '../../../features/discovery/official-lives.tsx';
import { BranchList, type BranchCategory } from '../../../features/discovery/branch-list.tsx';
import {
  worldDateTimeLabel,
  worldWeekday,
} from '../../../modules/world/domain/display-time.ts';
import styles from './preview.module.css';

export interface FixtureLife {
  id: string;
  title: string;
  identity: string;
  storyNow: string; // ISO
  paused: boolean;
  speed: number;
  summary?: string;
  realityBaseline: {
    realName: string;
    profession: string;
    hometown: string;
    turningPoint: string;
  };
  parallelTrajectory: {
    premise: string;
    choice: string;
    openingScene: string;
    tradeoff: string;
    chapter: string;
  };
  director: {
    guidance: string;
    themes: string[];
    pacing: 'slow' | 'normal' | 'fast';
    focusActors: string[];
    beatsPerAdvance: number;
  };
}

const FIXTURE_LIVES: FixtureLife[] = [
  {
    id: 'county-yellow-hair',
    title: '县城修车青年',
    identity: '23岁 · 县城修车青年',
    storyNow: '2026-09-24T00:30:00.000Z',
    paused: false,
    speed: 12,
    summary: '清晨，修理铺刚拉起卷帘门，街坊推来漏气的自行车。',
    realityBaseline: {
      realName: '真实用户档案',
      profession: '一线城市产品经理',
      hometown: '江南水乡小镇',
      turningPoint: '高中毕业后选择考去外省大学，离开老家县城。',
    },
    parallelTrajectory: {
      premise: '如果当年没有离开县城，留在街角开了一间修理铺。',
      choice: '选择学一门修车手艺，在熟悉的人情圈子里扎下根。',
      openingScene: '清晨薄雾散开，她在饭桌旁等你回家见长辈。',
      tradeoff: '获得踏实的生活与近旁陪伴，但也需要面对熟人社会的审视与人情成本。',
      chapter: '第一幕 · 归家饭局与街坊问候',
    },
    director: {
      guidance: '把节奏放慢，多写县城早市与修车铺的日常人情。',
      themes: ['人情羁绊', '故乡', '成长选择'],
      pacing: 'normal',
      focusActors: ['小芳', '父亲'],
      beatsPerAdvance: 2,
    },
  },
  {
    id: 'only-child',
    title: '江浙沪独生子',
    identity: '25岁 · 家族企业独生子',
    storyNow: '2026-09-24T02:00:00.000Z',
    paused: true,
    speed: 1,
    summary: '交谈中时间放缓：在茶室里与长辈谈起下半年开拓新业务的意向。',
    realityBaseline: {
      realName: '真实用户档案',
      profession: '自由职业创作者',
      hometown: '北方省会城市',
      turningPoint: '选择独立创业，拒绝了家人安排的稳定工作。',
    },
    parallelTrajectory: {
      premise: '如果出生在江浙沪经商家庭，家里希望你接手产业。',
      choice: '既想探索自己的创意品牌，又需要兼顾家族工厂的交接。',
      openingScene: '家族聚会后的茶室，手机收到另一家独立设计工作室的合伙邀请。',
      tradeoff: '拥有雄厚的发展资源，但背负传承责任与期望的束缚。',
      chapter: '第二幕 · 家族聚会与两难抉择',
    },
    director: {
      guidance: '强化父子之间的沟通与各自坚持，避免直接对抗。',
      themes: ['家族责任', '自我追寻', '商业抉择'],
      pacing: 'slow',
      focusActors: ['父亲', '合伙人阿林'],
      beatsPerAdvance: 1,
    },
  },
  {
    id: 'seaside-cafe',
    title: '海边咖啡馆店主',
    identity: '28岁 · 准备开业的咖啡店主',
    storyNow: '2026-09-24T09:15:00.000Z',
    paused: false,
    speed: 12,
    summary: '老朋友推门进来，带来了手绘开业海报和新豆子样品。',
    realityBaseline: {
      realName: '真实用户档案',
      profession: '互联网大厂员工',
      hometown: '内陆城市',
      turningPoint: '每天在高楼格子间忙碌，一直向往看海生活。',
    },
    parallelTrajectory: {
      premise: '如果辞职来到海边，与老友合伙开一间面向大海的咖啡小馆。',
      choice: '把积蓄投入装修改造，尝试在海浪声中找回节奏。',
      openingScene: '黄昏的退潮时刻，咖啡机的蒸汽与海风交织。',
      tradeoff: '享受辽阔自由的日常，同时需应对旅游淡季的客流与营运压力。',
      chapter: '第一幕 · 试营业倒计时',
    },
    director: {
      guidance: '烘托海边傍晚的光影氛围，对话自然亲切。',
      themes: ['生活节奏', '友情', '海边日常'],
      pacing: 'normal',
      focusActors: ['老友苏苏', '常客渔民伯伯'],
      beatsPerAdvance: 2,
    },
  },
];

const OFFICIAL_CARDS: OfficialLifeCardView[] = [
  {
    id: 'county-yellow-hair',
    title: '县城黄毛',
    hook: '她坚持带你回家。饭桌上，却坐着她爸更中意的人。',
    identity: '23岁 · 县城修车青年',
    artwork: 'garage',
    hasSave: true,
    experienceNote: '开发样板：可直接进入体验或核对时间推进。',
  },
  {
    id: 'only-child',
    title: '江浙沪独生子',
    hook: '家里让你接班，你却收到了另一份邀请。',
    identity: '25岁 · 家族企业独生子',
    artwork: 'lake',
    hasSave: true,
    experienceNote: '开发样板：已暂停时间状态与交谈放缓。',
  },
  {
    id: 'returned-daughter',
    title: '刚回家的真千金',
    hook: '今晚的生日宴，主角好像还是她。',
    identity: '24岁 · 刚找回身世的女儿',
    artwork: 'house',
    hasSave: false,
    experienceNote: '开发样板：展示原创插画与新剧情起点。',
  },
  {
    id: 'retired-star',
    title: '退圈后的顶流',
    hook: '离开舞台以后，还有谁在等你？',
    identity: '28岁 · 搬到海边的退圈歌手',
    artwork: 'stage',
    hasSave: false,
    experienceNote: '开发样板：展示全新平行人生草案。',
  },
];

type PreviewTab = 'lives' | 'trajectory' | 'director' | 'clock';

/**
 * L-05 UI Preview Fixture:
 * Comprehensive presentation covering:
 * 1. Multi-life selection and branches (Official & personal lives).
 * 2. Reality baseline vs. Parallel trajectories comparison.
 * 3. Director panel (Guidance, pacing, themes, actor focus, impact preview, advance simulation).
 * 4. Branch preview dialog.
 * 5. Time interface with clear current life, date & time, clock flow and wait controls.
 */
export function LivesPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('lives');
  const [selectedLifeId, setSelectedLifeId] = useState<string>('county-yellow-hair');
  const [lives, setLives] = useState<FixtureLife[]>(FIXTURE_LIVES);
  const [branchCategory, setBranchCategory] = useState<BranchCategory>('all');
  const [previewBranch, setPreviewBranch] = useState<{
    title: string;
    identity: string;
    premise: string;
    tradeoff: string;
  } | null>(null);
  const [directorImpact, setDirectorImpact] = useState<string>('');
  const [actionNotice, setActionNotice] = useState<string>('');

  const currentLife = lives.find((l) => l.id === selectedLifeId) ?? lives[0]!;

  function updateCurrentLife(patch: Partial<FixtureLife>) {
    setLives((prev) =>
      prev.map((item) => (item.id === currentLife.id ? { ...item, ...patch } : item)),
    );
  }

  const currentFormattedTime = worldDateTimeLabel(currentLife.storyNow);
  const currentFormattedWeekday = worldWeekday(currentLife.storyNow);

  return (
    <main className={styles.page}>
      <AppViewport />
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>多人生与时间 · 界面验收样板</h1>
          <span className={styles.fixtureBadge}>L-05 验收夹具</span>
        </div>

        {/* Current Life & Story Date Header Banner */}
        <div className={styles.statusBar} role="region" aria-label="当前人生与故事时间">
          <div className={styles.currentLifeInfo}>
            <span className={styles.lifeDot} />
            <strong>当前人生：{currentLife.title}</strong>
            <span style={{ fontSize: 12, color: 'var(--text-secondary, #64606c)' }}>
              ({currentLife.identity})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={styles.currentDateTime}>
              故事时刻：{currentFormattedTime} ({currentFormattedWeekday})
            </span>
            <span
              className={`${styles.clockBadge} ${
                currentLife.paused ? styles.clockBadgePaused : styles.clockBadgeActive
              }`}
            >
              {currentLife.paused ? '已暂停' : `${currentLife.speed}× 流逝中`}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className={styles.tabNav} aria-label="样板视图切换">
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'lives' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('lives')}
          >
            多人生与分支
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'trajectory' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('trajectory')}
          >
            现实与平行轨迹
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'director' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('director')}
          >
            导演面板
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'clock' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('clock')}
          >
            时间界面
          </button>
        </nav>
      </header>

      <div className={styles.content}>
        {/* Quick Life Selector across views */}
        <div className={styles.lifeSelector} aria-label="切换当前体验人生">
          {lives.map((life) => (
            <button
              key={life.id}
              type="button"
              className={`${styles.lifeChip} ${
                life.id === currentLife.id ? styles.lifeChipActive : ''
              }`}
              onClick={() => {
                setSelectedLifeId(life.id);
                setDirectorImpact('');
                setActionNotice(`已切换到人生：${life.title}`);
              }}
            >
              {life.title}
            </button>
          ))}
        </div>

        {/* Tab 1: Multi-lives & Branches */}
        {activeTab === 'lives' && (
          <div>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>官方预设与多人生副本</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['all', 'featured', 'mine'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`${styles.btn} ${branchCategory === cat ? styles.btnActive : ''}`}
                      onClick={() => setBranchCategory(cat)}
                    >
                      {cat === 'all' ? '全部' : cat === 'featured' ? '精选' : '我的'}
                    </button>
                  ))}
                </div>
              </div>
              <OfficialLivesView
                cards={OFFICIAL_CARDS}
                category={branchCategory}
                onOpen={(id) => {
                  setSelectedLifeId(id);
                  setActionNotice(`已选择精选人生：${id}`);
                }}
                onReload={() => setActionNotice('精选目录已刷新')}
              />
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>平行分支列表与提议</h2>
              </div>
              <BranchList
                items={[
                  {
                    id: 'preview-personal',
                    title: '如果我开一家海边咖啡馆',
                    identity: '准备开业的店主',
                    description: '傍晚，老朋友带着一叠手写菜单推门进来。',
                    premise: '如果当年告别大厂，在海边买下一处二手木屋开咖啡馆。',
                    tradeoff: '享受海风与自由，但要面对旅游淡季的客流波动与生活自理挑战。',
                    ready: true,
                    status: '进入体验',
                  },
                  {
                    id: 'preview-draft',
                    title: '如果我回到那次电影试拍前',
                    identity: '青年演员 / 编剧',
                    description: '合成验收样板：长标题和未创建状态。',
                    premise: '回到当年那次重要试镜的前夜，改变准备策略。',
                    tradeoff: '可能争取到心仪的角色，但需要放弃原来的稳定签约。',
                    status: '继续构思',
                    experienceNote: '还没有创建手机，可以继续构思。',
                  },
                ]}
                onOpen={(id) => {
                  if (id === 'preview-personal') {
                    setPreviewBranch({
                      title: '如果我开一家海边咖啡馆',
                      identity: '准备开业的店主',
                      premise: '如果当年告别大厂，在海边买下一处二手木屋开咖啡馆。',
                      tradeoff: '享受海风与自由，但要面对旅游淡季的客流波动与生活自理挑战。',
                    });
                  }
                }}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Reality Baseline vs. Parallel Trajectory */}
        {activeTab === 'trajectory' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>现实档案与平行轨迹对比</h2>
              <span className={styles.fixtureBadge}>真实/虚构隔离保护</span>
            </div>
            <div className={styles.noticeBanner}>
              真实访谈与隐私资料严格停留在现实档案层；平行世界只接收经脱敏与授权的可见设定，角色不获知真实姓名与现实私密记忆。
            </div>
            <div className={styles.trajectoryGrid} style={{ marginTop: 14 }}>
              {/* Reality Track */}
              <div className={styles.trajectoryTrack}>
                <div className={styles.trajectoryTrackTitle}>
                  <span>📍 现实生活基线 (不可变事实)</span>
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>现实身份：</span>
                  {currentLife.realityBaseline.profession}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>原籍背景：</span>
                  {currentLife.realityBaseline.hometown}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>关键分叉点：</span>
                  {currentLife.realityBaseline.turningPoint}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>档案权限：</span>
                  <span>绝密隔离 · 不进入NPC对话</span>
                </div>
              </div>

              {/* Parallel Trajectory Track */}
              <div className={styles.trajectoryTrack} style={{ background: '#f8fafc' }}>
                <div className={styles.trajectoryTrackTitle}>
                  <span style={{ color: 'var(--accent, #7050cb)' }}>
                    ✨ 平行世界轨迹 ({currentLife.title})
                  </span>
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>平行身份：</span>
                  {currentLife.identity}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>如果假设：</span>
                  {currentLife.parallelTrajectory.premise}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>分叉抉择：</span>
                  {currentLife.parallelTrajectory.choice}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>核心代价：</span>
                  {currentLife.parallelTrajectory.tradeoff}
                </div>
                <div className={styles.trajectoryItem}>
                  <span className={styles.trajectoryLabel}>当前进度：</span>
                  <strong>{currentLife.parallelTrajectory.chapter}</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Director Panel */}
        {activeTab === 'director' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>导演面板 · 剧情调度与要求</h2>
              <span className={styles.fixtureBadge}>{currentLife.title}</span>
            </div>
            <div className={styles.noticeBanner}>
              已经发生的事不会被改写；想换一种走法，请建立一个分支，原本的人生会完整保留。
            </div>
            <div className={styles.directorSection} style={{ marginTop: 14 }}>
              <label className={styles.fieldLabel}>
                <span>导演期望与演进方向：</span>
                <textarea
                  className={styles.textarea}
                  rows={2}
                  value={currentLife.director.guidance}
                  onChange={(e) =>
                    updateCurrentLife({
                      director: { ...currentLife.director, guidance: e.target.value },
                    })
                  }
                  placeholder="例如：多安排小巷与修车铺的温馨互动"
                />
              </label>

              <label className={styles.fieldLabel}>
                <span>剧情核心主题（用顿号分隔）：</span>
                <input
                  type="text"
                  className={styles.input}
                  value={currentLife.director.themes.join('、')}
                  onChange={(e) =>
                    updateCurrentLife({
                      director: {
                        ...currentLife.director,
                        themes: e.target.value.split(/[、,，\s]+/).filter(Boolean),
                      },
                    })
                  }
                />
              </label>

              <div className={styles.fieldLabel}>
                <span>剧情节奏快慢：</span>
                <div className={styles.buttonRow}>
                  {(['slow', 'normal', 'fast'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`${styles.btn} ${
                        currentLife.director.pacing === p ? styles.btnActive : ''
                      }`}
                      onClick={() =>
                        updateCurrentLife({
                          director: { ...currentLife.director, pacing: p },
                        })
                      }
                    >
                      {p === 'slow' ? '慢节奏 (日常沉淀)' : p === 'normal' ? '适中' : '紧凑 (快速推进)'}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.fieldLabel}>
                <span>希望多出场的人物焦点：</span>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {['小芳', '父亲', '老友苏苏', '常客渔民伯伯'].map((actor) => {
                    const checked = currentLife.director.focusActors.includes(actor);
                    return (
                      <label key={actor} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...currentLife.director.focusActors, actor]
                              : currentLife.director.focusActors.filter((a) => a !== actor);
                            updateCurrentLife({
                              director: { ...currentLife.director, focusActors: next },
                            });
                          }}
                        />
                        <span style={{ fontSize: 13 }}>{actor}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className={styles.buttonRow} style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    setDirectorImpact(
                      `接下来每次推进最多 ${currentLife.director.beatsPerAdvance} 件事，` +
                        `重点人物：${currentLife.director.focusActors.join('、') || '自然轮转'}，` +
                        `节奏：${
                          currentLife.director.pacing === 'slow'
                            ? '慢'
                            : currentLife.director.pacing === 'normal'
                              ? '正常'
                              : '快'
                        }。`,
                    );
                  }}
                >
                  先看影响
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => {
                    setActionNotice('导演要求已保存生效，将指导后续事件演进。');
                  }}
                >
                  应用要求
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    // Simulate advance
                    const date = new Date(currentLife.storyNow);
                    date.setMinutes(date.getMinutes() + 15);
                    updateCurrentLife({
                      storyNow: date.toISOString(),
                      summary: `剧情推进了 ${currentLife.director.beatsPerAdvance} 件事，人物有了新日常。`,
                    });
                    setActionNotice('世界推进了 1 拍，手机已同步最新来信与约定。');
                  }}
                >
                  让世界走一会儿 (+1拍)
                </button>
              </div>

              {directorImpact && (
                <div role="status" className={styles.noticeBanner} style={{ marginTop: 6 }}>
                  {directorImpact}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Time Interface */}
        {activeTab === 'clock' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>时间界面与时钟控制</h2>
              <span className={styles.fixtureBadge}>{currentLife.title}</span>
            </div>

            <div className={styles.timeClockCard}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #64606c)' }}>
                  当前人生时刻
                </div>
                <div className={styles.timeBigDisplay}>
                  {currentFormattedTime}
                  <span style={{ fontSize: 15, fontWeight: 400, marginLeft: 8 }}>
                    {currentFormattedWeekday}
                  </span>
                </div>
                <div className={styles.timeSubtitle}>
                  {currentLife.paused
                    ? '已暂停自动推进'
                    : currentLife.speed === 1
                      ? '交谈中，时间放缓 (1×)'
                      : `日常流逝 (${currentLife.speed}×)`}
                </div>
              </div>

              {currentLife.summary && (
                <div className={styles.noticeBanner}>{currentLife.summary}</div>
              )}

              <div className={styles.timeActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => {
                    const nextPaused = !currentLife.paused;
                    updateCurrentLife({ paused: nextPaused });
                    setActionNotice(nextPaused ? '时间已暂停' : '时间已恢复流逝');
                  }}
                >
                  {currentLife.paused ? '继续时间' : '暂停时间'}
                </button>

                {[1, 2, 12].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.btn} ${currentLife.speed === s ? styles.btnActive : ''}`}
                    onClick={() => {
                      updateCurrentLife({ speed: s, paused: false });
                      setActionNotice(`流逝速度已设为 ${s}×`);
                    }}
                  >
                    {s}× 速度
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #24222c)', marginTop: 8 }}>
                快速时间等待操作：
              </div>
              <div className={styles.timeActions}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    const d = new Date(currentLife.storyNow);
                    d.setMinutes(d.getMinutes() + 15);
                    updateCurrentLife({
                      storyNow: d.toISOString(),
                      summary: '稍等了一会儿（+15分钟），街角有了新动静。',
                    });
                    setActionNotice('已快进 15 分钟');
                  }}
                >
                  稍等一会 (+15分)
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    const d = new Date(currentLife.storyNow);
                    d.setHours(d.getHours() + 2);
                    updateCurrentLife({
                      storyNow: d.toISOString(),
                      summary: '等待至赴约前：出发前往约定地点。',
                    });
                    setActionNotice('已等待至赴约前（+2小时）');
                  }}
                >
                  等到赴约前
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    const d = new Date(currentLife.storyNow);
                    d.setDate(d.getDate() + 1);
                    d.setHours(8, 0, 0, 0);
                    updateCurrentLife({
                      storyNow: d.toISOString(),
                      summary: '夜深沉睡，新的一天清晨到来。',
                    });
                    setActionNotice('已休息至明早 08:00');
                  }}
                >
                  休息到明早
                </button>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-secondary, #64606c)', margin: '4px 0 0' }}>
                规则说明：浏览时以 12 倍速推进日常；进入实时聊天时自动放缓为 1 倍速；离开后时钟安全暂停。
              </p>
            </div>
          </div>
        )}

        {actionNotice && (
          <p role="status" style={{ fontSize: 13, color: 'var(--success, #28785d)', marginTop: 12 }}>
            {actionNotice}
          </p>
        )}
      </div>

      {/* Branch Preview Modal */}
      {previewBranch && (
        <div className={styles.previewModal} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className={styles.modalContent}>
            <h3 id="modal-title" style={{ margin: '0 0 10px', fontSize: 16 }}>
              {previewBranch.title}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #64606c)', margin: '0 0 8px' }}>
              身份：{previewBranch.identity}
            </p>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
              <strong>开场假设：</strong>
              {previewBranch.premise}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              <strong>核心代价：</strong>
              {previewBranch.tradeoff}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setPreviewBranch(null)}
              >
                关闭预览
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => {
                  setPreviewBranch(null);
                  setActionNotice('已进入该分支的手机准备流程。');
                }}
              >
                进入体验
              </button>
            </div>
          </div>
        </div>
      )}

      <AppTabs active="possibilities" />
    </main>
  );
}
