import { isSimpleSceneQuestion } from '../../../modules/world/domain/scene-delivery.ts';
import type { SceneAction } from '../../../modules/world/domain/experience-rules.ts';
import type { SceneEntry } from '../../../modules/world/domain/experience-rules.ts';
/** Keep every saved narrative turn; repeat location metadata only when it actually changes. */
export function sceneTimelineEntries(
  entries: readonly SceneEntry[],
  actions: readonly SceneAction[] = [],
): SceneEntry[] {
  let last: Extract<SceneEntry, { kind: 'time_place' }> | undefined;
  return entries.filter((entry) => {
    if (entry.kind === 'adjudicated_result') {
      const action = actions.find((a) => a.id === entry.actionId);
      if (action && isSimpleSceneQuestion(action, true) && entry.text === action.text.trim())
        return false;
    }
    if (entry.kind !== 'time_place') return true;
    const repeat = last?.location === entry.location && last?.storyAt === entry.storyAt;
    last = entry;
    return !repeat;
  });
}
