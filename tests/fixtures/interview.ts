/** Synthetic test fixtures ONLY. No product import or automatic fallback to these records. */
import type { InterviewWorkspace } from '../../src/contracts/api.ts';
export const emptyWorkspace: InterviewWorkspace = {
  interview: {
    id: 'af97e186-42d2-4023-92e5-a4b1d5c44fa0',
    version: 0,
    messages: [],
    activeTask: null,
  },
  profile: {
    id: 'dafb09e5-9379-47fb-8f3a-a9e6302d2b30',
    version: 0,
    facts: [],
    events: [],
    people: [],
    portraitAssetId: null,
    updatedAt: '2026-09-22T00:00:00.000Z',
  },
};
export const states = ['loading', 'empty', 'ready', 'failed', 'conflict', 'unknown'] as const;
