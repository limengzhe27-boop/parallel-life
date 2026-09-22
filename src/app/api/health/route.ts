export function GET() {
  return Response.json(
    { service: 'parallel-life', status: 'ok', stage: 'interview' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
