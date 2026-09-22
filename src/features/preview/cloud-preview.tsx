'use client';
import { useState } from 'react';
import { WorkspaceShell } from '../../components/workspace-shell.tsx';
import { AppTabs } from '../../components/app-tabs.tsx';
import { AppViewport } from '../../components/app-viewport.tsx';
import { Welcome } from '../interview/interview-app.tsx';
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
const banner = <p className="cloud-preview-banner">界面预览 · AI 与资料保存尚未接入</p>;
export function CloudPreview({ page = 'chat' }: { page?: 'chat' | 'possibilities' }) {
  const [draft, setDraft] = useState('');
  if (page === 'possibilities')
    return (
      <div className="discovery-page">
        <header className="discovery-header">
          <span className="wordmark">
            如果<span className="wordmark-dot">✳</span>
          </span>
          <span className="workspace-caption">你的每一种可能</span>
        </header>
        <main className="discovery-main">
          {banner}
          <section className="discovery-intro">
            <p className="eyebrow">不同的选择，不同的你</p>
            <h1>
              你的那些“如果”，
              <br />
              都在这里。
            </h1>
            <p>从聊天里的一个念头开始，留住你想体验的人生。</p>
            <img
              className="discovery-illustration"
              src="/art/open-door.webp"
              alt="通用插画：通向另一种可能的门"
            />
          </section>
          <section className="cloud-preview-empty">
            <h2>故事，从你开始。</h2>
            <p>后台接入后，与你聊出的不同人生会出现在这里。当前预览不会生成故事或保存资料。</p>
            <a className="button secondary" href="/">
              回到聊聊
            </a>
          </section>
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
          <header className="profile-title">
            <p className="eyebrow">一点一点，认识你</p>
            <h2>这就是我</h2>
            <p>未来，你在聊天中提到的事会整理在这里。</p>
          </header>
          <fieldset disabled className="preview-fields">
            <BasicInfo profile={profile} onSave={noSave} />
          </fieldset>
          <p className="cloud-preview-empty">照片、重要人物和人生经历将在后台接入后开放。</p>
        </>
      }
      footer={
        <div className="composer-area">
          <div className="composer">
            <textarea
              aria-label="预览聊天输入"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="说说最近的你…"
            />
            <div className="composer-bottom">
              <span className="composer-tip">预览内容不会发送或保存</span>
              <button className="button secondary" disabled>
                发送
              </button>
            </div>
          </div>
        </div>
      }
    >
      {banner}
      <fieldset disabled className="preview-fields">
        <BasicInfo compact profile={profile} onSave={noSave} />
      </fieldset>
      <Welcome choose={setDraft} />
    </WorkspaceShell>
  );
}
