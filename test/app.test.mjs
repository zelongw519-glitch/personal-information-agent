import assert from 'node:assert/strict';
import { mkdtemp, unlink, rmdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Script } from 'node:vm';
import test from 'node:test';
import { startServer } from '../server.mjs';
import { openLocalDatabase } from '../local-db.mjs';
import worker from '../dist/server/index.js';

async function temporaryDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-information-agent-'));
  const filename = join(directory, 'test.sqlite');
  t.after(async () => {
    await unlink(filename);
    await rmdir(directory);
  });
  return filename;
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test('local records remain searchable and completed after restarting the server', async t => {
  const databasePath = await temporaryDatabase(t);
  let server = await startServer({ port: 0, databasePath, apiKey: '' });
  try {
    let origin = 'http://127.0.0.1:' + server.address().port;
    const homepage = await fetch(origin);
    assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /个人信息管家/);

    const created = await fetch(origin + '/api/entries', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'spoofed-user' },
      body: JSON.stringify({ title: '项目上线', body: '检查上线资料', kind: '待办' }),
    });
    assert.equal(created.status, 201);
    const { entry } = await created.json();
    const completed = await fetch(origin + '/api/complete', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, done: true }),
    });
    assert.equal(completed.status, 200);

    await stopServer(server);
    server = await startServer({ port: 0, databasePath, apiKey: '' });
    origin = 'http://127.0.0.1:' + server.address().port;
    const result = await (await fetch(origin + '/api/entries?q=' + encodeURIComponent('上线'))).json();
    assert.equal(result.storage, 'local');
    assert.equal(result.ai, false);
    assert.equal(result.stats.pending, 0);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].id, entry.id);
    assert.equal(result.entries[0].done, 1);

    const unavailable = await fetch(origin + '/api/ask', {
      method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ question: '上线有什么要做？' }),
    });
    assert.equal(unavailable.status, 503);
  } finally {
    await stopServer(server);
  }
});

test('local server rejects foreign browser origins and foreign hostnames', async t => {
  const databasePath = await temporaryDatabase(t);
  const server = await startServer({ port: 0, databasePath, apiKey: '' });
  try {
    const port = server.address().port;
    const origin = 'http://127.0.0.1:' + port;
    const response = await fetch(origin + '/api/entries', { headers: { Origin: 'https://example.com' } });
    assert.equal(response.status, 403);
    const crossSite = await fetch(origin + '/api/entries', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    const missingOrigin = await fetch(origin + '/api/entries', {
      method: 'POST', body: JSON.stringify({ body: 'must not be saved' }),
    });
    assert.equal(missingOrigin.status, 403);

    const hostnameStatus = await new Promise((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: '/api/entries', headers: { Host: 'example.com' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(hostnameStatus, 403);
    assert.equal((await (await fetch(origin + '/api/entries')).json()).stats.total, 0);
  } finally {
    await stopServer(server);
  }
});

test('cloud Worker isolates owners and filters model references to accessible records', async t => {
  const databasePath = await temporaryDatabase(t);
  const db = openLocalDatabase(databasePath);
  const env = { DB: db, OPENAI_API_KEY: 'test-key' };
  const origin = 'https://app.example.com';
  const call = (path, data, owner = 'alice') => worker.fetch(new Request(origin + '/api/' + path, {
    method: data ? 'POST' : 'GET',
    headers: { Origin: origin, 'oai-authenticated-user-id': owner },
    body: data ? JSON.stringify(data) : undefined,
  }), env);

  try {
    const { entry: alice } = await (await call('entries', { body: '提交上线资料', kind: '待办' })).json();
    const { entry: bob } = await (await call('entries', { body: 'bob-private-record' }, 'bob')).json();
    assert.equal((await call('entry', { id: bob.id })).status, 404);
    assert.equal((await call('entries', null, '')).status, 401);

    const inputs = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      inputs.push(options.body);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        kind: '待办', summary: '整理上线资料', highlights: ['上线准备'], tasks: ['提交资料'],
        related: [bob.id], answer: '下一步提交上线资料', actions: ['提交资料'], sources: [alice.id, bob.id, 'invented-id'],
      }) } }] });
    });

    assert.equal((await call('organize', { id: alice.id })).status, 200);
    const organized = await (await call('entry', { id: alice.id })).json();
    assert.equal(organized.entry.analysis.summary, '整理上线资料');
    assert.deepEqual(organized.entry.analysis.related, []);
    for (const path of ['ask', 'review']) {
      const answer = await (await call(path, { question: '上线怎么做？', days: 7 })).json();
      assert.deepEqual(answer.sources.map(source => source.id), [alice.id]);
      assert.equal(answer.actions[0], '提交资料');
    }
    assert.equal(inputs.length, 3);
    for (const input of inputs) {
      assert.ok(!input.includes('bob-private-record'));
      assert.ok(!input.includes(bob.id));
    }
  } finally {
    db.close();
  }
});

test('browser application JavaScript parses', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Script(source));
});
