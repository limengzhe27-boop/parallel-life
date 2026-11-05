import { getServices } from '../../../server/services.ts';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const services = getServices();
    const result = await services.db.pool.query('select 1 as ok');
    return Response.json({ ok: true, db: result.rows[0] });
  } catch (error) {
    const value = error as { message?: string; code?: string };
    return Response.json(
      { ok: false, message: value.message ?? 'unknown', code: value.code ?? null },
      { status: 500 },
    );
  }
}
