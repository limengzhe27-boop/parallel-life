'use client';
import { useState } from 'react';
import { Welcome } from '../../../features/interview/interview-app.tsx';
import { Onboarding } from '../../../features/interview/onboarding.tsx';
import { WorkspaceShell } from '../../../components/workspace-shell.tsx';
export function WelcomePreview() {
  const [draft, setDraft] = useState(''),
    [started, setStarted] = useState(false);
  if (!started)
    return (
      <Onboarding
        profile={{
          id: '10000000-0000-4000-8000-000000000001',
          version: 0,
          facts: [],
          events: [],
          people: [],
          portraitAssetId: null,
          updatedAt: '2026-09-22T00:00:00Z',
        }}
        onStart={() => setStarted(true)}
        onSave={async () => {}}
      />
    );
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
      <Welcome choose={setDraft} />
    </WorkspaceShell>
  );
}
