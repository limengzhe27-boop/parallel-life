'use client';
import { useState } from 'react';
import { Welcome } from '../../../features/interview/interview-app.tsx';
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
      <Welcome choose={setDraft} />
    </WorkspaceShell>
  );
}
