import { after } from 'next/server';
import { runCommittedSceneMedia } from '../../../../../../server/scene-media-tasks.ts';
import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { runOwnedTask } from '../../../../../../server/run-task.ts';
import { Id } from '../../../../../../contracts/api.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    const task = await s.tasks.get(s.ownerId, id.data);
    const resumeMedia = (result: typeof task) => {
      if (result.status === 'succeeded' && result.scope.kind === 'world')
        after(async () => {
          try {
            await runCommittedSceneMedia(s.db, s.ownerId, id.data);
          } catch {
            console.warn(
              JSON.stringify({ scope: 'scene-media-task', code: 'EXECUTION_UNAVAILABLE' }),
            );
          }
        });
    };
    if (!['queued', 'running'].includes(task.status)) {
      resumeMedia(task);
      return json(task);
    }
    await requestLimit(s.db, s.ownerId);
    await runOwnedTask(s.ownerId, id.data);
    const finished = await s.tasks.get(s.ownerId, id.data);
    resumeMedia(finished);
    return json(finished);
  });
}
