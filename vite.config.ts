import { defineConfig, loadEnv, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPilotHandler } from './server/pilot';

/**
 * Dev-server middleware that proxies autopilot decisions to TypeSafe (Jev)
 * through the AI SDK. The API key stays server-side.
 */
function pilotApi(env: Record<string, string>): Plugin {
  const handler = createPilotHandler(env.TYPESAFE_AI_API_KEY);
  return {
    name: 'pilot-api',
    configureServer(server) {
      server.middlewares.use('/api/pilot', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const result = await handler(JSON.parse(body));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[pilot]', err instanceof Error ? err.message : err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [pilotApi(env)],
    server: { port: 5173 },
  };
});
