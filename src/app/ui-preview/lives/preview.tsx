'use client';
import { AppViewport } from '../../../components/app-viewport.tsx';
import { AppTabs } from '../../../components/app-tabs.tsx';
import { OfficialLivesView } from '../../../features/discovery/official-lives.tsx';
import { BranchList } from '../../../features/discovery/branch-list.tsx';
/** Explicit developer-only presentation fixtures; no live account, model, or save. */
export function LivesPreview() {
  return (
    <main className="discovery-page">
      <AppViewport />
      <header className="discovery-header">
        <h1 className="outer-title">分支 · 界面验收样板</h1>
      </header>
      <div className="discovery-main">
        <OfficialLivesView
          cards={[
            {
              id: 'county-yellow-hair',
              title: '县城黄毛',
              hook: '她坚持带你回家。饭桌上，却坐着她爸更中意的人。',
              identity: '23岁 · 县城修车青年',
              artwork: 'garage',
              hasSave: false,
              experienceNote: '开发样板：原创人生副本，预览按钮不创建存档。',
            },
            {
              id: 'only-child',
              title: '江浙沪独生子',
              hook: '家里让你接班，你却收到了另一份邀请。',
              identity: '25岁 · 家族企业独生子',
              artwork: 'lake',
              hasSave: true,
              experienceNote: '开发样板：展示继续存档的布局。',
            },
            {
              id: 'returned-daughter',
              title: '刚回家的真千金',
              hook: '今晚的生日宴，主角好像还是她。',
              identity: '24岁 · 刚找回身世的女儿',
              artwork: 'house',
              hasSave: false,
              experienceNote: '开发样板：展示原创插画。',
            },
            {
              id: 'retired-star',
              title: '退圈后的顶流',
              hook: '离开舞台以后，还有谁在等你？',
              identity: '28岁 · 搬到海边的退圈歌手',
              artwork: 'stage',
              hasSave: false,
              experienceNote: '开发样板：展示原创插画。',
            },
          ]}
          onOpen={() => {}}
          onReload={() => {}}
        />
        <BranchList
          items={[
            {
              id: 'preview-personal',
              title: '如果我开一家海边咖啡馆',
              identity: '正在准备开业的店主',
              description: '傍晚，老朋友带着一叠手写菜单推门进来。',
              premise: '合成验收样板：这个标题不是模型生成，也不是你的存档。',
              tradeoff: '选择和朋友一起做事，也要商量如何分担开店的成本。',
              ready: true,
              status: '进入体验',
            },
            {
              id: 'preview-draft',
              title: '如果我回到那次电影试拍前，重新选择自己的角色',
              description: '合成验收样板：长标题和未创建状态。',
              status: '继续构思',
              experienceNote: '还没有创建手机，可以继续构思。',
            },
          ]}
          onOpen={() => {}}
        />
      </div>
      <AppTabs active="possibilities" />
    </main>
  );
}
