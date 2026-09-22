export function GET() {
  return Response.json({ service: 'parallel-life', status: 'ok', stage: 'architecture-scaffold' }, { headers: { 'Cache-Control': 'no-store' } });
}
