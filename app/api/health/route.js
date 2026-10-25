import { healthPayload } from '../../../lib/project-overview.mjs';

export function GET() {
  return Response.json(healthPayload(), { headers: { 'Cache-Control': 'no-store' } });
}
