import { authenticated, endpoint, parseBody } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { InterviewSendSchema } from '../../../../../contracts/api.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, InterviewSendSchema);
    const encoder = new TextEncoder();
    const frame = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            const result = await s.interview.sendStreaming(
              s.ownerId,
              input,
              s.interviewPlanner,
              (token) => controller.enqueue(frame('token', { text: token })),
              request.signal,
            );
            controller.enqueue(
              frame('result', {
                task: result.task,
                interview: result.interview,
              }),
            );
            controller.close();
          } catch (error) {
            const code =
              error instanceof Error && 'code' in error
                ? String((error as Error & { code?: string }).code)
                : 'UNAVAILABLE';
            controller.enqueue(
              frame('error', {
                code: ['VERSION_CONFLICT', 'BUSY', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND'].includes(
                  code,
                )
                  ? code
                  : 'UNAVAILABLE',
                message: '这次回应没有完成，你说的话已经保存，可以再试一次。',
              }),
            );
            controller.close();
          }
        })();
      },
      cancel() {
        /* The request signal aborts the upstream model when the client leaves. */
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}
