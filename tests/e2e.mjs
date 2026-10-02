import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { blankQuestion } from '../core.js';

const root=fileURLToPath(new URL('../',import.meta.url)); const results=path.join(root,'test-results'); await mkdir(results,{recursive:true});
const modelRequests=[];
const mock=createServer(async(req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});if(req.url==='/chat'){let body='';for await(const chunk of req)body+=chunk;modelRequests.push(JSON.parse(body));res.end(JSON.stringify({choices:[{message:{content:'adapter-ok'}}]}));}else res.end(JSON.stringify({version:1,categories:[],questions:[]}));});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const port=4392,bankURL=`http://127.0.0.1:${mock.address().port}`;
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),QBANK_BANK_URL:bankURL,QBANK_LLM_URL:bankURL+'/chat',QBANK_LLM_MODEL:'test-model'},stdio:'pipe',windowsHide:true});
let output=''; server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
let browser,page;const errors=[]; const watch=p=>p.on('pageerror',e=>errors.push(e.message));
try{
  for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok)break;}catch{}if(i===49)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
  const executablePath=process.env.QBANK_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});page=await context.newPage();watch(page);
  // Isolate template behavior from whatever content a future cloner supplies.
  await page.route('**/content/bank.json',route=>route.fulfill({json:{version:1,categories:[],questions:[]}}));
  const requests=[];page.on('request',req=>{if(!req.url().startsWith(`http://127.0.0.1:${port}`)&&!req.url().startsWith('data:'))requests.push(req.url());});
  await page.goto(`http://127.0.0.1:${port}`);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='空白框架已就绪');
  assert.equal(await page.locator('#nav-count').textContent(),'0');assert.equal(await page.locator('.stat-value').count(),4);
  await page.screenshot({path:path.join(results,'overview.png'),fullPage:true});
  await page.locator('[data-nav=practice]').click();assert.equal(await page.locator('#start-practice').isDisabled(),true);
  await page.locator('[data-nav=bank]').click();await page.locator('[data-action=new-question]').click();
  assert.equal(await page.locator('#q-stem').inputValue(),'');await page.locator('#q-status').selectOption('ready');
  await page.locator('#question-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#editor-error').textContent.includes('题干'));
  assert.equal(await page.locator('#question-dialog').evaluate(el=>el.open),true);
  for(const type of ['multiple','boolean','fill','text','single']){await page.locator('#q-type').selectOption(type);assert.equal(await page.locator('#q-stem').inputValue(),'');}
  await page.locator('#q-status').selectOption('draft');await page.locator('#question-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#question-dialog').open);assert.equal(await page.locator('#nav-count').textContent(),'1');
  await page.locator('#undo-change').click();await page.waitForFunction(()=>document.querySelector('#nav-count').textContent==='0');
  await page.locator('#category-name').fill('classification');await page.locator('#category-form button').click();
  await page.waitForFunction(()=>document.querySelector('.category-list').textContent.includes('classification'));
  await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存在本机');await page.reload();
  await page.waitForFunction(()=>document.querySelector('.category-list').textContent.includes('classification'));
  const promise=page.waitForEvent('download');await page.locator('#quick-export').click();const download=await promise;const backupPath=path.join(results,'empty-backup.json');await download.saveAs(backupPath);
  const backup=JSON.parse(await readFile(backupPath,'utf8'));assert.equal(backup.data.questions.length,0);assert.equal(backup.data.sessions.length,0);assert.equal(backup.data.categories.length,1);
  console.log('PASS empty framework, disabled practice, blank editor types, validation, undo, persistence and backups');

  await page.locator('[data-nav=connect]').click();await page.locator('[data-action=api-fetch-bank]').click();await page.locator('#confirm-dialog').waitFor({state:'visible'});
  assert.match(await page.locator('#confirm-description').textContent(),/0 道题目/);await page.locator('#confirm-action').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='题库已合并。');
  await page.locator('#api-transport').selectOption('direct');await page.locator('#api-key').fill('temporary-test-token');await page.locator('#api-bank-url').fill(bankURL);
  await page.locator('#api-form button[type=submit]').click();assert.equal(await page.evaluate(()=>localStorage.getItem('offline-qbank-api').includes('temporary-test-token')),false);
  const crossOrigin=await fetch(`http://127.0.0.1:${port}/api/bank`,{headers:{Origin:'https://example.com'}});assert.equal(crossOrigin.status,403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/.env.local`)).status,403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/llm`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  console.log('PASS bank API via configured local proxy and API key exclusion from persistent data');

  // Nonsemantic object markers exercise controls without supplying real questions.
  // These exist only in an isolated temporary browser profile, never in bank.json.
  const marker=String.fromCodePoint(0xfffc);
  const structural=['single','multiple','boolean','fill','text'].map(type=>{
    const q=blankQuestion();q.type=type;q.status='ready';q.stem=marker;q.options=q.options.map(o=>({...o,text:marker}));
    q.answer=type==='single'?q.options[0].id:type==='multiple'?q.options.map(o=>o.id):type==='boolean'?true:type==='fill'?[[marker]]:marker;
    return q;
  });
  await page.locator('#api-transport').selectOption('proxy');await page.locator('#api-form button[type=submit]').click();
  await page.locator('#file-input').setInputFiles({name:'structure.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,categories:[],questions:structural}))});
  await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.locator('#confirm-action').click();await page.waitForFunction(()=>document.querySelector('#nav-count').textContent==='5');
  await page.locator('[data-nav=practice]').click();await page.locator('#practice-shuffle').uncheck();await page.locator('#practice-count').fill('5');await page.locator('#start-practice').click();
  await page.locator('[data-action=ai-hint]').click();await page.waitForFunction(()=>document.querySelector('#ai-output').textContent==='adapter-ok');
  assert.equal(modelRequests.length,1);assert.equal(JSON.parse(modelRequests[0].messages[1].content).referenceAnswer,undefined);
  for(let i=0;i<5;i++){
    if(i===0)await page.locator('#response-inputs input').first().check();
    if(i===1)for(const input of await page.locator('#response-inputs input').all())await input.check();
    if(i===2)await page.locator('#response-inputs input').first().check();
    if(i===3){await page.locator('[data-fill]').fill(marker);await page.locator('[data-fill]').press('Tab');}
    if(i===4){await page.locator('#practice-text').fill(marker);await page.locator('#practice-text').press('Tab');}
    await page.locator('[data-action=submit-answer]').click();
    if(i===4)await page.locator('[data-action=manual-correct]').click();
    if(i<4)await page.locator('[data-action=next]').click();
  }
  await page.locator('[data-action=finish-practice]').click();await page.locator('#confirm-action').click();
  await page.waitForFunction(()=>document.querySelector('.record-list')?.textContent.includes('正确 5'));
  assert.match(await page.locator('.record-list').textContent(),/得分 5 \/ 5/);
  console.log('PASS all five answer controls, scoring, completion history and model API via local proxy using structural markers only');

  const offlineContext=await browser.newContext({offline:true,viewport:{width:1280,height:900}}),offline=await offlineContext.newPage();watch(offline);
  const external=[];offline.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await offline.goto(pathToFileURL(path.join(root,'dist/offline-qbank.html')).href);await offline.waitForFunction(()=>document.querySelector('#save-state').textContent==='空白框架已就绪');
  const authored=JSON.parse(await readFile(path.join(root,'content/bank.json'),'utf8')).questions.length;
  assert.equal(Number(await offline.locator('#nav-count').textContent()),authored);await offline.locator('[data-nav=bank]').click();await offline.locator('[data-action=new-question]').click();assert.equal(await offline.locator('#q-stem').inputValue(),'');await offline.locator('[data-close=question-dialog]').first().click();
  await offline.locator('[data-nav=connect]').click();assert.equal(await offline.locator('#api-transport').inputValue(),'direct');
  assert.deepEqual(external,[]);await offline.locator('[data-nav=overview]').click();await offline.screenshot({path:path.join(results,'offline.png'),fullPage:true});
  await offline.setViewportSize({width:390,height:844});await offline.screenshot({path:path.join(results,'mobile.png'),fullPage:true});
  assert.equal(await offline.evaluate(()=>document.body.scrollWidth<=innerWidth),true);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log('PASS standalone HTML with networking disabled, mobile layout, and no seeded questions');
}catch(error){if(page)await page.screenshot({path:path.join(results,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();server.kill();mock.close();}
