export function GET() {
  return Response.json(
    {
      service: 'parallel-life',
      status: 'ok',
      stage: process.env.APP_PREVIEW_ONLY === '1' ? 'ui-preview' : 'interview',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
