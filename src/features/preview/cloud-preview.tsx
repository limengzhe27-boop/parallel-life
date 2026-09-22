'use client';
import { useState } from 'react';
import { WorkspaceShell } from '../../components/workspace-shell.tsx';
import { AppTabs } from '../../components/app-tabs.tsx';
import { AppViewport } from '../../components/app-viewport.tsx';
import { Icon } from '../../components/ui.tsx';
import { Welcome, ProfilePane } from '../interview/interview-app.tsx';
import { BasicInfo } from '../interview/basic-info.tsx';
import type { Profile } from '../../contracts/api.ts';
const profile: Profile = {
  id: '10000000-0000-4000-8000-000000000001',
  version: 0,
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
  updatedAt: '2026-09-22T00:00:00Z',
};
const noSave = async () => {
  throw new Error('PREVIEW_ONLY');
};
const banner = <p className="cloud-preview-banner">界面预览 · 暂不发送或保存</p>;
export function CloudPreview({ page = 'chat' }: { page?: 'chat' | 'possibilities' }) {
  const [draft, setDraft] = useState('');
  if (page === 'possibilities')
    return (
      <div className="discovery-page">
        <header className="discovery-header">
          <h1 className="outer-title">分支</h1>
          <a href="/" className="new-branch" aria-label="聊聊新的分支">
            <Icon name="plus" size={24} />
          </a>
        </header>
        <main className="discovery-main">
          {banner}
          <div className="branch-empty">
            <Icon name="spark" size={32} />
            <h2>还没有分支</h2>
            <p>聊聊你想体验的另一种生活。</p>
            <a className="button primary" href="/">
              去聊聊
            </a>
          </div>
        </main>
        <AppTabs active="possibilities" />
        <AppViewport />
      </div>
    );
  return (
    <WorkspaceShell
      profile={
        <>
          {banner}
          <fieldset disabled className="preview-fields">
            <ProfilePane
              profile={profile}
              uploading={false}
              saving={false}
              onUpload={() => {}}
              onEdit={() => {}}
              onConfirm={() => {}}
              basicInfo={<BasicInfo profile={profile} onSave={noSave} />}
              events={
                <p className="preview-profile-placeholder">你聊过的人和经历，会整理在这里。</p>
              }
            />
          </fieldset>
        </>
      }
      footer={
        <div className="composer-area">
          <div className="composer">
            <textarea
              aria-label="预览聊天输入"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="说点什么…"
            />
            <div className="composer-bottom">
              <button className="button primary" disabled aria-label="发送消息">
                <Icon name="send" size={18} />
              </button>
            </div>
          </div>
        </div>
      }
    >
      {banner}
      <Welcome choose={setDraft} />
    </WorkspaceShell>
  );
}
