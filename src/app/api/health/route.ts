import { isPreviewOnly } from '../../../contracts/preview.ts';
export function GET() {
  return Response.json(
    {
      service: 'parallel-life',
      status: 'ok',
      stage: isPreviewOnly() ? 'ui-preview' : 'interview',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
