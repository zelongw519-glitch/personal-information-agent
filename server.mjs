import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { openLocalDatabase } from './local-db.mjs';
import worker from './dist/server/index.js';

export async function startServer({
  port = Number(process.env.PORT || 3000),
  databasePath = 'data/personal-information-agent.sqlite',
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.OPENAI_MODEL || 'gpt-4.1-mini',
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const db = openLocalDatabase(databasePath);
  const env = { DB: db, OPENAI_API_KEY: apiKey, OPENAI_MODEL: model, LOCAL_DEVELOPMENT: true };
  const server = createServer(async (incoming, outgoing) => {
    const actualPort = server.address().port;
    const allowedHosts = ['127.0.0.1:' + actualPort, 'localhost:' + actualPort];
    const origin = 'http://' + incoming.headers.host;

    // Reject external browser origins and DNS rebinding before assigning local identity.
    if (!allowedHosts.includes(incoming.headers.host)
        || incoming.headers['sec-fetch-site'] === 'cross-site'
        || (incoming.headers.origin && incoming.headers.origin !== origin)) {
      outgoing.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      outgoing.end('仅允许本地页面访问。');
      return;
    }

    try {
      const url = new URL(incoming.url, origin);
      if (url.origin !== origin) {
        outgoing.writeHead(403);
        outgoing.end();
        return;
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 96 * 1024) {
          outgoing.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          outgoing.end(JSON.stringify({ error: '内容过长' }));
          return;
        }
        chunks.push(chunk);
      }

      const headers = new Headers();
      headers.set('oai-authenticated-user-id', 'local-user');
      if (incoming.headers.origin) headers.set('Origin', incoming.headers.origin);
      if (incoming.headers['content-type']) headers.set('Content-Type', incoming.headers['content-type']);

      const request = new Request(url, {
        method: incoming.method,
        headers,
        body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await worker.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      outgoing.end(JSON.stringify({ error: '本地服务暂时不可用。' }));
    }
  });

  server.once('close', () => db.close());
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
  } catch (error) {
    db.close();
    throw error;
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer();
  console.log('拾简已启动 http://127.0.0.1:' + server.address().port);
  console.log('本地开发模式 · 数据保存在 data/ 目录');
  const shutdown = () => server.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
