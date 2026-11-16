import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });

const [worker, page] = await Promise.all([
  readFile('worker.mjs', 'utf8'),
  readFile('index.html', 'utf8'),
]);

await writeFile('dist/server/index.js', 'const PAGE = ' + JSON.stringify(page) + ';\n' + worker);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
