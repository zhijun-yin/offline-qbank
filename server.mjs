import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { callLLM, fetchBank } from './adapters/api.js';
import { validateQuestion } from './core.js';
import { compileBank } from './bank.js';
const root = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(root,'.env.local');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const port = Number(process.env.PORT || 4174);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
createServer(async (req,res) => {
  try {
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const expectedOrigin = `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; }
      try {
        let result;
        if (url.pathname === '/api/llm' && req.method === 'POST') {
          req.setEncoding('utf8'); let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body,'utf8') > 262144) throw new Error('请求内容过大。'); }
          const payload = JSON.parse(body); payload.question = validateQuestion(payload.question,null,true);
          result = { text: await callLLM({llmEndpoint:process.env.QBANK_LLM_URL || '',model:process.env.QBANK_LLM_MODEL || '',apiKey:process.env.QBANK_LLM_KEY,timeoutMs:30000},payload) };
        } else if (url.pathname === '/api/bank' && req.method === 'GET') {
          result = compileBank(await fetchBank({bankEndpoint:process.env.QBANK_BANK_URL || '',bankKey:process.env.QBANK_BANK_KEY,timeoutMs:30000}));
        } else { res.writeHead(405); res.end(); return; }
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:error.message})); }
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(url.pathname);
    const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const parts = relative(root,target).split(sep);
    if (!target.startsWith(root+sep) || parts.some(part => part.startsWith('.') || ['node_modules','test-results'].includes(part.toLowerCase()))) { res.writeHead(403); res.end(); return; }
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port,'127.0.0.1', () => console.log(`OfflineQBank: http://127.0.0.1:${port}`));
