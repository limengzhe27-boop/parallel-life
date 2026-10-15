import type { StoryWaitInput, StoryWaitReceipt } from '../domain/story-wait.ts';
export interface StoryWaitPort {
  wait(ownerId: string, worldId: string, input: StoryWaitInput): Promise<StoryWaitReceipt>;
}
/** One explicit, zero-model transaction. Resume is part of the persisted wait, not a second request. */
export function waitInStory(
  waits: StoryWaitPort,
  ownerId: string,
  worldId: string,
  input: StoryWaitInput,
) {
  return waits.wait(ownerId, worldId, input);
}
