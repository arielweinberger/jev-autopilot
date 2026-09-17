import { createPilotHandler } from '../server/pilot.js';
import type { Telemetry } from '../src/types';

// Vercel serverless function. Locally the same handler runs as Vite middleware (vite.config.ts).
let handler: ReturnType<typeof createPilotHandler> | null = null;

export async function POST(request: Request): Promise<Response> {
  try {
    handler ??= createPilotHandler(process.env.TYPESAFE_AI_API_KEY);
    const telemetry = (await request.json()) as Telemetry;
    return Response.json(await handler(telemetry));
  } catch (err) {
    console.error('[pilot]', err instanceof Error ? err.message : err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
