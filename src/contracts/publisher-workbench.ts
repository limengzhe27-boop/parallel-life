import type { PublisherWork, PublisherCheckResult } from './world-publisher.ts';
import type { z } from 'zod';
import type { PublisherWorkSummarySchema } from './world-publisher.ts';

export type PublisherWorkbenchDraft = {
  title: string;
  content: Record<string, unknown>;
};

/** View callbacks are wired by the authenticated controller, never a publication authority. */
export type PublisherWorkbenchProps = {
  session: { displayName: string; canEdit: boolean; canPublish: boolean };
  works: z.infer<typeof PublisherWorkSummarySchema>[];
  work: PublisherWork | null;
  check: PublisherCheckResult | null;
  busy: boolean;
  error: { code: string; message: string } | null;
  onSelectWork: (workId: string) => void;
  onCreateWork: (input: PublisherWorkbenchDraft) => void;
  onSaveDraft: (input: PublisherWorkbenchDraft) => void;
  onRenameWork?: (workId: string, newTitle: string) => void;
  onDeleteWork?: (workId: string) => void;
  onCheck: () => void;
  onTrial?: () => void;
  onPublish?: () => void;
  onLogout: () => void;
};
