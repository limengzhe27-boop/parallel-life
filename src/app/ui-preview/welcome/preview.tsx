'use client';
import { useState } from 'react';
import { Welcome } from '../../../features/interview/interview-app.tsx';
import { BasicInfo } from '../../../features/interview/basic-info.tsx';
import { WorkspaceShell } from '../../../components/workspace-shell.tsx';
export function WelcomePreview() {
  const [draft, setDraft] = useState('');
  return (
    <WorkspaceShell
      profile={<p>开发预览 · 无个人档案</p>}
      footer={
        <div className="composer-area">
          <div className="composer">
            <textarea
              aria-label="预览草稿"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="说说最近的你…"
            />
          </div>
        </div>
      }
    >
      <p className="preview-label">开发预览 · 未调用模型或保存资料</p>
      <BasicInfo
        compact
        profile={{
          id: '10000000-0000-4000-8000-000000000001',
          version: 0,
          facts: [],
          events: [],
          people: [],
          portraitAssetId: null,
      referenceAssetIds: [],
          updatedAt: '2026-09-22T00:00:00Z',
        }}
        onSave={async () => {
          throw new Error('preview only');
        }}
      />
      <Welcome choose={setDraft} />
    </WorkspaceShell>
  );
}
