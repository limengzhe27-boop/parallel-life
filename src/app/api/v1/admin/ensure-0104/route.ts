import { authenticated, endpoint, json } from '../../../../../server/http.ts';
import { ensure0104Admin } from '../../../../../server/ensure-0104-admin.ts';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** One-shot owner maintenance route for the missing plan-review migration. */
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    try {
      return json(await s.ensure0104(s.ownerId));
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === '42501') {
        try {
          return json(await ensure0104Admin());
        } catch (adminError) {
          return json({
            error: {
              message: adminError instanceof Error ? adminError.message : String(adminError),
              code: (adminError as { code?: unknown } | null)?.code ?? null,
            },
          });
        }
      }
      return json({
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: (error as { code?: unknown } | null)?.code ?? null,
        },
      });
    }
  });
}
