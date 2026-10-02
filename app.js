import sourceBank from './content/bank.json' with { type: 'json' };
import config from './config.js';
import { TYPES, DIFFICULTIES, emptyState, blankQuestion, validateQuestion, validateState, clone, uid, removeCategory, selectQuestions, createSession, sessionSummary, gradeAnswer, wrongIds, encodeBackup, decodeBackup } from './core.js';
import { compileBank, mergeBank } from './bank.js';
import { readDocument, writeDocuments } from './storage.js';
import { callLLM, fetchBank, proxyRequest } from './adapters/api.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const titles = {overview:'概览',bank:'我的题库',practice:'开始练习',records:'练习记录',connect:'API 与数据'};
let state = emptyState(), undoState = null, qDraft = null, toastTimer, revision = 0;
let bankFilter = {search:'',category:'',type:'',status:''}, practiceFilter = {categoryId:'',type:'',difficulty:'',wrongOnly:false};
let aiBusy = false, aiText = '', bootError = '';
const settings = {...config.api,apiKey:'',bankKey:''};
if (location.protocol === 'file:') settings.transport = 'direct';
try {
  const saved = JSON.parse(localStorage.getItem('offline-qbank-api') || 'null');
  if (saved) for (const key of ['llmEndpoint','model','bankEndpoint','transport']) if (typeof saved[key] === 'string') settings[key] = saved[key];
  if (!['direct','proxy'].includes(settings.transport) || location.protocol === 'file:') settings.transport = 'direct';
} catch {}
const page = () => Object.hasOwn(titles,location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
const categoryName = id => state.categories.find(c => c.id === id)?.name || '未分类';
const activeSession = () => state.sessions.find(s => s.status === 'active');
const options = (items,selected,all='全部') => `<option value="">${all}</option>` + items.map(([value,label]) => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
const categoryOptions = (selected,all) => options(state.categories.map(c => [c.id,c.name]),selected,all);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true,4500); }
function download(name,content) { const url = URL.createObjectURL(new Blob([content],{type:'application/json'})); const a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),15000); }
function exportBackup() { download(`offline-qbank-${new Date().toISOString().slice(0,10)}.json`,encodeBackup(state)); toast('备份已导出，不包含 API 密钥。'); }
async function commit(next, notice = '', rerender = true, remember = true) {
  const checked = validateState(next); if (remember) undoState = clone(state); state = checked;
  const current = ++revision; $('save-state').textContent = '正在保存…';
  if (rerender) render(); $('undo-change').disabled = !undoState;
  try { await writeDocuments([['state',clone(state)]]); if (revision === current) $('save-state').textContent = '已保存在本机'; }
  catch { if (revision === current) $('save-state').textContent = '保存失败，请导出备份'; toast('浏览器存储不可用，请导出备份保存当前内容。'); }
  if (notice) toast(notice);
}
function heading(title,description,action='') { return `<div class="page-heading"><div><div class="eyebrow">YOUR LEARNING SPACE</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`; }
function empty(title,description,buttons='',compact=false) { return `<div class="empty ${compact?'compact':''}"><div class="empty-art" aria-hidden="true">▤</div><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="empty-actions">${buttons}</div></div>`; }
function stat(label,value,unit,caption,icon) { return `<div class="stat"><div class="stat-top">${label}<span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-caption">${caption}</div></div>`; }
function overview() {
  const completed = state.sessions.filter(s=>s.status==='completed').length;
  const ready = selectQuestions(state).length;
  return heading(config.title,config.subtitle,'<span class="pill"><span class="status-dot"></span>本地题库 · 可选 API</span>') +
    `<div class="stats">${stat('题库总量',state.questions.length,'题',`${ready} 题可练习`,'▤')}${stat('知识分类',state.categories.length,'个','由你定义知识结构','◫')}${stat('完成练习',completed,'次','进度保存在本机','◷')}${stat('当前错题',wrongIds(state).size,'题','依据最近一次已评阅作答','↺')}</div>
    <div class="overview-grid"><section class="panel"><div class="panel-heading"><h2>你的学习，从这里开始</h2><span>QUESTION LIBRARY</span></div>${state.questions.length ? `<div class="empty"><div class="empty-art" aria-hidden="true">▤</div><h3>题库已准备好</h3><p>${state.questions.length} 条记录，${ready} 道可练习题目。继续整理题库，或开始一次练习。</p><div class="empty-actions"><a class="button primary" href="#practice">开始练习 →</a><a class="button" href="#bank">查看题库</a></div></div>` : empty('这里将是你的题库','框架已就绪，还没有任何题目。开发者可以填入本地题库，也可以接入自己的题库 API。','<button class="button primary" data-action="import">导入 JSON →</button><a class="button" href="#bank">管理题库</a>')}</section>
    <aside class="panel start-guide"><div class="guide-head">GET STARTED</div><h2>把框架，变成你的题库</h2><p>从空白开始，内容完全由你决定。</p><div class="guide-step"><span class="guide-number">01</span><div><h3>填入自己的题目</h3><p>编辑 <code>content/bank.json</code><br>或从页面导入 JSON。</p></div></div><div class="guide-step"><span class="guide-number">02</span><div><h3>选好连接方式</h3><p>离线学习无需 API。<br>需要时再配置模型或题库服务。</p></div></div><div class="guide-step"><span class="guide-number">03</span><div><h3>开始练习，积累进度</h3><p>支持客观题自动判分，<br>简答题自评及 AI 参考评阅。</p></div></div></aside></div>
    <section class="panel quick-strip"><div><h3>想接入自己的服务？</h3><p>大模型讲解与远程题库都留有独立适配器，可以按需替换。</p></div><a href="#connect" class="text-button">配置 API 与数据 →</a></section>`;
}
function bank() {
  const wrong = wrongIds(state);
  const records = state.questions.filter(q => (!bankFilter.category || q.categoryId===bankFilter.category) && (!bankFilter.type || q.type===bankFilter.type) && (!bankFilter.status || (bankFilter.status==='wrong' ? wrong.has(q.id) : q.status===bankFilter.status)) && (!bankFilter.search || `${q.stem} ${q.tags.join(' ')}`.toLocaleLowerCase().includes(bankFilter.search.toLocaleLowerCase())));
  const rows = records.map(q => `<div class="question-row"><div class="question-main"><div class="badges"><span class="badge">${TYPES[q.type]}</span><span class="badge">${esc(categoryName(q.categoryId))}</span><span class="badge ${q.status==='draft'?'draft':''}">${q.status==='draft'?'草稿':'可练习'}</span>${wrong.has(q.id)?'<span class="badge wrong">错题</span>':''}</div><h3>${esc(q.stem || '未命名草稿')}</h3></div><div class="row-actions"><button class="text-button" data-action="edit-question" data-id="${q.id}">编辑</button><button class="text-button" data-action="delete-question" data-id="${q.id}">删除</button></div></div>`).join('');
  return heading('我的题库','整理内容、定义分类，让练习按你的方式展开。','<button class="button primary" data-action="new-question">＋ 添加题目</button>') +
    `<div class="bank-layout"><section class="panel"><div class="toolbar"><input id="bank-search" aria-label="搜索题干和标签" placeholder="搜索题干或标签" value="${esc(bankFilter.search)}"><select id="bank-category" aria-label="筛选分类">${categoryOptions(bankFilter.category,'全部分类')}</select><select id="bank-type" aria-label="筛选题型">${options(Object.entries(TYPES),bankFilter.type,'全部题型')}</select><select id="bank-status" aria-label="筛选状态">${options([['draft','草稿'],['ready','可练习'],['wrong','错题']],bankFilter.status,'全部状态')}</select></div>${records.length?`<div class="question-list">${rows}</div>`:empty(state.questions.length?'没有匹配的记录':'题库还是空白的',state.questions.length?'调整筛选条件，或者添加新的内容。':'没有预装题目。你可以在仓库填入自己的题库，也可以从这里添加或导入。','<button class="button" data-action="import">导入题库 JSON</button>')}</section>
    <aside class="panel category-panel"><h3>知识分类</h3><p class="subtext">分类由题库作者自行定义。</p><div class="category-list">${state.categories.length?state.categories.map(c=>`<div class="category-row"><span>${esc(c.name)} · ${state.questions.filter(q=>q.categoryId===c.id).length}</span><button data-action="delete-category" data-id="${c.id}" aria-label="删除分类 ${esc(c.name)}">×</button></div>`).join(''):'<p class="blank-label">尚未创建分类。</p>'}</div><form id="category-form" class="category-form"><input id="category-name" maxlength="60" aria-label="新分类名称" placeholder="输入分类名称" required><button class="button small" type="submit">＋ 创建分类</button></form></aside></div>`;
}
function practiceSetup() {
  const available = selectQuestions(state,practiceFilter).length;
  return heading('开始练习','选择范围，组成一份适合自己的练习。') + `<div class="content-grid"><section class="panel form-panel"><h2>练习设置</h2><form id="practice-form"><div class="form-grid"><label>知识分类<select id="practice-category">${categoryOptions(practiceFilter.categoryId,'全部分类')}</select></label><label>题型<select id="practice-type">${options(Object.entries(TYPES),practiceFilter.type,'全部题型')}</select></label><label>难度<select id="practice-difficulty">${options(Object.entries(DIFFICULTIES),practiceFilter.difficulty,'全部难度')}</select></label><label>题目数量<input id="practice-count" type="number" min="1" max="200" value="${Math.max(1,Math.min(10,available))}"></label><label class="check-label field-span"><input id="practice-wrong" type="checkbox" ${practiceFilter.wrongOnly?'checked':''}>只练习当前错题</label><label class="check-label field-span"><input id="practice-shuffle" type="checkbox" checked>随机排列题目</label></div><div class="form-actions"><p id="available-count">当前范围有 <b>${available}</b> 道可练习题目。</p><button id="start-practice" class="button primary" type="submit" ${available?'':'disabled'}>开始练习 →</button></div></form>${available?'':'<div class="notice"><strong>框架已准备好。</strong> 添加完整题目并设为「可练习」后，练习功能会自动启用。草稿不会加入练习。</div>'}</section><aside class="panel form-panel"><h3>练习方式</h3><ul class="muted-list"><li>单选、多选、判断与填空自动判分</li><li>简答题保留人工自评入口</li><li>过程自动保存，可中途离开</li><li>AI 提示和评阅需要配置 API</li></ul><p class="section-copy">框架面向个人学习，不用于可信考试评分。</p></aside></div>`;
}
function answerDescription(q) {
  if (q.type==='single') return q.options.find(o=>o.id===q.answer)?.text || '';
  if (q.type==='multiple') return q.options.filter(o=>q.answer.includes(o.id)).map(o=>o.text).join('；');
  if (q.type==='boolean') return q.answer?'正确':'错误';
  if (q.type==='fill') return q.answer.map(v=>v.join(' / ')).join('；');
  return q.answer || '未提供参考答案，请自行评阅。';
}
function practiceRun(session) {
  const index = session.index, q = session.questions[index], response = session.responses[index];
  const result = response.submitted ? gradeAnswer(q,response.answer,response.manual) : null;
  let input = '';
  if (q.type==='single' || q.type==='multiple') input = q.options.map((option,i)=>`<label class="answer-option"><input data-response="${option.id}" type="${q.type==='single'?'radio':'checkbox'}" name="practice-answer" ${q.type==='single'?response.answer===option.id?'checked':'':response.answer?.includes(option.id)?'checked':''} ${response.submitted?'disabled':''}><span>${String.fromCharCode(65+i)}. ${esc(option.text)}</span></label>`).join('');
  else if (q.type==='boolean') input = [true,false].map(value=>`<label class="answer-option"><input type="radio" name="practice-answer" data-response="${value}" ${response.answer===value?'checked':''} ${response.submitted?'disabled':''}><span>${value?'正确':'错误'}</span></label>`).join('');
  else if (q.type==='fill') input = q.answer.map((_,i)=>`<label>第 ${i+1} 空<input data-fill="${i}" value="${esc(response.answer?.[i] || '')}" maxlength="500" ${response.submitted?'disabled':''}></label>`).join('');
  else input = `<label>你的作答<textarea id="practice-text" rows="6" maxlength="10000" ${response.submitted?'disabled':''}>${esc(response.answer || '')}</textarea></label>`;
  return heading('正在练习',`${session.name} · 进度自动保存在本机`,'<button class="button" data-action="finish-practice">结束练习</button>') + `<div class="content-grid"><section class="panel practice-card"><div class="practice-meta"><div class="badges"><span class="badge">${TYPES[q.type]}</span><span class="badge">${DIFFICULTIES[q.difficulty]}</span><span class="badge">${q.score} 分</span></div><span class="subtext">${index+1} / ${session.questions.length}</span></div><div class="practice-stem">${esc(q.stem)}</div><div id="response-inputs">${input}</div>${response.submitted?`<div class="feedback-panel ${result===false?'wrong':''}"><b>${result===null?'等待自评':result?'回答正确':'需要再练习'}</b><br>参考答案：${esc(answerDescription(q))}${q.explanation?`<br><br>${esc(q.explanation)}`:''}${q.type==='text'?'<div class="ai-actions"><button class="button small" data-action="manual-correct">自评：正确</button><button class="button small" data-action="manual-wrong">自评：需改进</button></div>':''}</div>`:''}<div class="practice-bottom"><button class="button" data-action="previous" ${index===0?'disabled':''}>← 上一题</button><div>${response.submitted?'':'<button class="button primary" data-action="submit-answer">提交作答</button>'}<button class="button" data-action="next" ${index===session.questions.length-1?'disabled':''}>下一题 →</button></div></div></section><aside class="panel ai-panel"><h3>AI 学习助手</h3><p class="section-copy">按需调用你配置的服务。点击后会将本题内容发送给该服务；评阅还会包含作答。</p><div class="ai-actions"><button class="button small" data-action="ai-hint" ${aiBusy?'disabled':''}>给我提示</button><button class="button small" data-action="ai-explain" ${aiBusy?'disabled':''}>讲解</button>${q.type==='text'?`<button class="button small" data-action="ai-review" ${aiBusy?'disabled':''}>参考评阅</button>`:''}</div><div id="ai-output" class="ai-output" role="status">${esc(aiBusy?'正在请求…':aiText || '还没有调用 AI。离线作答不受影响。')}</div><a href="#connect" class="text-button">配置连接 →</a></aside></div>`;
}
function records() {
  const sessions = [...state.sessions].sort((a,b)=>b.createdAt-a.createdAt);
  const rows = sessions.map(s=>{ const summary=sessionSummary(s); return `<div class="record-row"><div><h3>${esc(s.name)} <span class="badge">${s.status==='active'?'进行中':'已完成'}</span></h3><p>${new Date(s.createdAt).toLocaleString()} · ${summary.total} 题<br>正确 ${summary.correct} · 需改进 ${summary.wrong} · 待自评 ${summary.pending} · 未提交 ${summary.skipped} · 得分 ${summary.score} / ${summary.maxScore}</p></div>${s.status==='active'?'<a href="#practice" class="button small">继续练习 →</a>':''}</div>`; }).join('');
  return heading('练习记录','回看自己的学习进度，简答题的 AI 评语不会自动计入分数。') + `<section class="panel"><div class="panel-heading"><h2>练习历史</h2><span>${sessions.length} 条记录</span></div>${sessions.length?`<div class="record-list">${rows}</div>`:empty('还没有练习记录','完成或开始一次练习后，记录会出现在这里。','<a href="#practice" class="button">设置练习 →</a>')}</section>`;
}
function connect() {
  const direct = settings.transport==='direct';
  return heading('API 与数据','本地题库、远程题库与模型服务，各自独立，可按需组合。') + `<div class="content-grid"><div class="section-stack"><section class="panel form-panel"><h2>API 连接</h2><p class="section-copy">连接是可选的。未配置 API 时，管理题库和练习仍可离线使用。</p><form id="api-form" class="api-form"><label>连接方式<select id="api-transport"><option value="proxy" ${direct?'':'selected'} ${location.protocol==='file:'?'disabled':''}>本机代理 · 密钥放在 .env.local</option><option value="direct" ${direct?'selected':''}>浏览器直连 · 密钥仅留在本次页面内存</option></select></label>${direct?`<div class="form-grid"><label class="field-span">大模型接口完整地址<input id="api-llm-url" type="url" value="${esc(settings.llmEndpoint)}" placeholder="完整的 chat-completions URL"></label><label>模型名称<input id="api-model" value="${esc(settings.model)}" placeholder="填写服务支持的模型 ID"></label><label>模型 API Key<input id="api-key" type="password" autocomplete="off" value="${esc(settings.apiKey)}" placeholder="可选，不保存或导出"></label></div><div class="api-separator"><label>题库 API 地址<input id="api-bank-url" type="url" value="${esc(settings.bankEndpoint)}" placeholder="返回题库 JSON 的完整 URL"></label></div><label>题库 API Key<input id="api-bank-key" type="password" autocomplete="off" value="${esc(settings.bankKey)}" placeholder="可选，不保存或导出"></label><div class="notice">浏览器直连需要服务端允许 CORS。双击离线 HTML 时，来源通常是 null；不兼容的服务请改用本机代理。</div>`:'<div class="notice">复制 <strong>.env.example</strong> 为 <strong>.env.local</strong>，填写服务地址、模型名称与密钥，然后重启本机服务。代理只调用配置好的地址。</div>'}<div class="data-actions"><button class="button primary" type="submit">应用连接设置</button><button class="button" type="button" data-action="api-fetch-bank">从 API 获取题库</button></div></form><p class="section-copy">获取后会先显示数量，再由你确认合并。同 ID 的题目会更新，已有练习快照保持原样。</p></section><section class="panel form-panel"><h2>备份与迁移</h2><p class="section-copy">备份包含题库、分类与练习记录，不包含 API 密钥。更换设备或浏览器时，请用 JSON 迁移数据。</p><div class="data-actions"><button class="button" data-action="export">导出完整备份</button><button class="button" data-action="import">导入 JSON</button><button class="button" data-action="recover">恢复上次替换前的数据</button></div></section></div><aside class="panel form-panel"><h3>开发者入口</h3><p class="section-copy">clone 后主要修改以下文件：</p><div class="code-path">content/bank.json</div><p class="subtext">分类和题目。默认是空数组。</p><div class="code-path">config.js</div><p class="subtext">标题与默认连接配置。</p><div class="code-path">adapters/api.js</div><p class="subtext">替换服务协议与数据转换。</p><div class="code-path">.env.local</div><p class="subtext">本机代理的私有连接配置。</p><div class="data-actions" style="margin-top:24px"><button class="button small" data-action="sync-source">同步仓库题库</button></div><p class="section-copy">更新仓库题库后，需要主动同步；不会覆盖你的本机题库而不提示。</p></aside></div>`;
}
function render() {
  const current = page(); document.title = `${titles[current]} · ${config.title}`; $('breadcrumb-page').textContent=titles[current]; $('nav-count').textContent=state.questions.length;
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===current));
  $('view').innerHTML = (bootError?`<div class="notice">${esc(bootError)}</div>`:'') + (current==='overview'?overview():current==='bank'?bank():current==='practice'?activeSession()?practiceRun(activeSession()):practiceSetup():current==='records'?records():connect());
}
function confirm(title,description,action) {
  $('confirm-title').textContent=title; $('confirm-description').textContent=description;
  $('confirm-action').onclick=async()=>{ $('confirm-dialog').close(); try { await action(); } catch(error) { toast(error.message); } };
  $('confirm-dialog').showModal();
}
function showIncoming(incoming,label) {
  const merged=mergeBank(state,incoming);
  confirm(label,`获取到 ${incoming.questions.length} 道题目和 ${incoming.categories.length} 个分类。\n将按 ID 合并；同 ID 的已有记录会更新。练习记录保留。`,()=>commit(merged,'题库已合并。'));
}
function renderAnswerEditor() {
  const q=qDraft;
  if (q.type==='single' || q.type==='multiple') $('answer-editor').innerHTML=`<label>选项与正确答案</label><p class="answer-help">填写选项，左侧选择正确答案。</p><div class="option-editor">${q.options.map((o,i)=>`<div class="option-edit-row"><input type="${q.type==='single'?'radio':'checkbox'}" name="editor-answer" data-correct="${o.id}" aria-label="正确答案 ${String.fromCharCode(65+i)}" ${q.type==='single'?q.answer===o.id?'checked':'':q.answer?.includes(o.id)?'checked':''}><span>${String.fromCharCode(65+i)}</span><input data-option="${o.id}" value="${esc(o.text)}" maxlength="2000" aria-label="选项 ${String.fromCharCode(65+i)}"><button type="button" class="remove-option" data-action="remove-option" data-id="${o.id}" aria-label="删除选项 ${String.fromCharCode(65+i)}">×</button></div>`).join('')}</div><button class="text-button" type="button" data-action="add-option">＋ 添加选项</button>`;
  else if (q.type==='boolean') $('answer-editor').innerHTML=`<label>正确答案</label><div class="radio-options">${[true,false].map(v=>`<label><input type="radio" name="editor-boolean" value="${v}" ${q.answer===v?'checked':''}>${v?'正确':'错误'}</label>`).join('')}</div>`;
  else if (q.type==='fill') $('answer-editor').innerHTML=`<label>可接受答案<textarea id="editor-fill" rows="3">${esc(q.answer.map(v=>v.join(' | ')).join('\n'))}</textarea></label><p class="answer-help">每行对应一个空，同一空的多个答案用 | 分隔。判分会忽略首尾空格、大小写和全角差异。</p>`;
  else $('answer-editor').innerHTML=`<label>参考答案<textarea id="editor-text" rows="3" maxlength="10000">${esc(q.answer)}</textarea></label><p class="answer-help">简答题由学习者自评。AI 评阅提供建议，不会自动改变分数。</p>`;
}
function readEditorAnswers() {
  const q=qDraft;
  if (q.type==='single' || q.type==='multiple') {
    q.options.forEach(o=>{ o.text=$('answer-editor').querySelector(`[data-option="${o.id}"]`).value; });
    const selected=[...$('answer-editor').querySelectorAll('[data-correct]:checked')].map(el=>el.dataset.correct);
    q.answer=q.type==='single'?selected[0]??null:selected;
  } else if (q.type==='boolean') { const selected=$('answer-editor').querySelector('input:checked'); q.answer=selected?selected.value==='true':null; }
  else if (q.type==='fill') q.answer=$('editor-fill').value.split('\n').filter(line=>line.trim()).map(line=>line.split('|').map(value=>value.trim()));
  else q.answer=$('editor-text').value;
}
function openEditor(id=null) {
  if (!id && state.questions.length>=5000) throw new Error('题库最多支持 5000 条记录。');
  qDraft=clone(id?state.questions.find(q=>q.id===id):blankQuestion());
  $('editor-title').textContent=id?'编辑题目':'添加题目'; $('q-type').value=qDraft.type; $('q-category').innerHTML=categoryOptions(qDraft.categoryId,'未分类');
  $('q-difficulty').value=qDraft.difficulty; $('q-stem').value=qDraft.stem; $('q-explanation').value=qDraft.explanation; $('q-tags').value=qDraft.tags.join('，'); $('q-score').value=qDraft.score; $('q-status').value=qDraft.status; $('editor-error').textContent=''; renderAnswerEditor(); $('question-dialog').showModal();
}
function readConnection() {
  settings.transport=$('api-transport').value;
  if (settings.transport==='direct' && $('api-llm-url')) { settings.llmEndpoint=$('api-llm-url').value.trim(); settings.model=$('api-model').value.trim(); settings.apiKey=$('api-key').value; settings.bankEndpoint=$('api-bank-url').value.trim(); settings.bankKey=$('api-bank-key').value; }
  const publicSettings={}; for (const key of ['transport','llmEndpoint','model','bankEndpoint']) publicSettings[key]=settings[key];
  try { localStorage.setItem('offline-qbank-api',JSON.stringify(publicSettings)); } catch {}
}
async function updateResponse(updater,rerender=false) {
  const next=clone(state), session=next.sessions.find(s=>s.status==='active'); if (!session) return;
  updater(session.responses[session.index],session.questions[session.index]); await commit(next,'',rerender,false);
}
async function ai(task) {
  if (aiBusy) return;
  const session=activeSession(); if (!session) return;
  const sessionId=session.id, index=session.index, q=session.questions[index], response=session.responses[index].answer;
  aiBusy=true; aiText=''; render();
  try { aiText=settings.transport==='proxy'?(await proxyRequest('llm',{task,question:q,response})).text:await callLLM(settings,{task,question:q,response}); }
  catch(error) { aiText=error.message; }
  finally { aiBusy=false; if (activeSession()?.id===sessionId && activeSession()?.index===index) render(); else aiText=''; }
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button'); if (!button) return;
  if (button.dataset.close) { $(button.dataset.close).close(); return; }
  const action=button.dataset.action;
  try {
    if (action==='new-question') openEditor();
    if (action==='edit-question') openEditor(button.dataset.id);
    if (action==='delete-question') confirm('删除题目','题目会从本机题库移除，历史练习快照保留。可以通过「撤销修改」恢复。',()=>{ const next=clone(state); next.questions=next.questions.filter(q=>q.id!==button.dataset.id); return commit(next,'题目已删除。'); });
    if (action==='delete-category') await commit(removeCategory(state,button.dataset.id),'分类已移除，题目保留在未分类中。');
    if (action==='export') exportBackup();
    if (action==='import') $('file-input').click();
    if (action==='recover') { const saved=await readDocument('recovery'); if (!saved) { toast('还没有可恢复的替换前备份。'); return; } const checked=validateState(saved); confirm('恢复上次替换前的数据','恢复会替换当前本机数据，也可以撤销这次恢复。',()=>commit(checked,'已恢复上次替换前的数据。')); }
    if (action==='sync-source') showIncoming(compileBank(sourceBank),'同步仓库题库');
    if (action==='api-fetch-bank') { readConnection(); button.disabled=true; button.textContent='正在获取…'; try { const data=settings.transport==='proxy'?await proxyRequest('bank'):compileBank(await fetchBank(settings)); showIncoming(data,'合并 API 题库'); } finally { button.disabled=false; button.textContent='从 API 获取题库'; } }
    if (action==='add-option') { readEditorAnswers(); if(qDraft.options.length>=10) throw new Error('最多支持 10 个选项。'); qDraft.options.push({id:uid(),text:''}); renderAnswerEditor(); }
    if (action==='remove-option') { readEditorAnswers(); qDraft.options=qDraft.options.filter(o=>o.id!==button.dataset.id); if(qDraft.type==='single' && qDraft.answer===button.dataset.id) qDraft.answer=null; if(qDraft.type==='multiple') qDraft.answer=qDraft.answer.filter(id=>id!==button.dataset.id); renderAnswerEditor(); }
    if (action==='submit-answer') await updateResponse(r=>r.submitted=true,true);
    if (action==='manual-correct' || action==='manual-wrong') await updateResponse(r=>r.manual=action==='manual-correct',true);
    if (action==='previous' || action==='next') { const next=clone(state), session=next.sessions.find(s=>s.status==='active'); if(session){ session.index=Math.max(0,Math.min(session.questions.length-1,session.index+(action==='next'?1:-1))); aiText=''; await commit(next,'',true,false); } }
    if (action==='finish-practice') confirm('结束这次练习','未提交的题目会记为未提交；已提交的简答题可以先完成自评。',()=>{ const next=clone(state),session=next.sessions.find(s=>s.status==='active'); session.status='completed'; session.finishedAt=Date.now(); aiText=''; location.hash='records'; return commit(next,'练习已结束。'); });
    if (action?.startsWith('ai-')) await ai(action.slice(3));
  } catch(error) { toast(error.message); }
});
$('quick-export').onclick=exportBackup;
$('undo-change').onclick=async()=>{ if(!undoState)return; const previous=undoState; undoState=null; await commit(previous,'已撤销上次修改。',true,false); $('undo-change').disabled=true; };
$('question-form').onsubmit=async event=>{
  event.preventDefault();
  try { readEditorAnswers(); Object.assign(qDraft,{type:$('q-type').value,categoryId:$('q-category').value||null,difficulty:$('q-difficulty').value,stem:$('q-stem').value,explanation:$('q-explanation').value,tags:$('q-tags').value.split(/[,，]/).map(v=>v.trim()).filter(Boolean),score:Number($('q-score').value),status:$('q-status').value,updatedAt:Date.now()}); const q=validateQuestion(qDraft,new Set(state.categories.map(c=>c.id))); const next=clone(state),index=next.questions.findIndex(item=>item.id===q.id); if(index<0)next.questions.push(q); else next.questions[index]=q; await commit(next,'题目已保存。'); $('question-dialog').close(); }
  catch(error){ $('editor-error').textContent=error.message; }
};
$('q-type').onchange=()=>{ readEditorAnswers(); qDraft.type=$('q-type').value; qDraft.answer=qDraft.type==='multiple'||qDraft.type==='fill'?[]:qDraft.type==='text'?'':null; if(!qDraft.options.length)qDraft.options=[{id:uid(),text:''},{id:uid(),text:''}]; renderAnswerEditor(); };
document.addEventListener('submit',async event=>{
  if(event.target.id==='category-form'){ event.preventDefault(); try{ const name=$('category-name').value.trim(); if(!name)return; const next=clone(state); next.categories.push({id:uid(),name,createdAt:Date.now()}); await commit(next,'分类已创建。'); }catch(error){toast(error.message);} }
  if(event.target.id==='practice-form'){ event.preventDefault(); try{ const session=createSession(state,practiceFilter,Number($('practice-count').value),$('practice-shuffle').checked); const next=clone(state); next.sessions.push(session); aiText=''; await commit(next,'练习已开始。'); }catch(error){toast(error.message);} }
  if(event.target.id==='api-form'){event.preventDefault(); readConnection(); toast('连接设置已应用。密钥不会保存或导出。');}
});
document.addEventListener('change',async event=>{
  const id=event.target.id;
  if(['bank-category','bank-type','bank-status'].includes(id)){ bankFilter[id.slice(5)]=event.target.value; render(); }
  if(['practice-category','practice-type','practice-difficulty','practice-wrong'].includes(id)){ const map={'practice-category':'categoryId','practice-type':'type','practice-difficulty':'difficulty','practice-wrong':'wrongOnly'}; practiceFilter[map[id]]=id==='practice-wrong'?event.target.checked:event.target.value; render(); }
  if(id==='api-transport'){ settings.transport=event.target.value; render(); }
  if(event.target.dataset.response){ await updateResponse((r,q)=>{ if(r.submitted)return; if(q.type==='multiple')r.answer=[...$('response-inputs').querySelectorAll('input:checked')].map(input=>input.dataset.response); else r.answer=q.type==='boolean'?event.target.dataset.response==='true':event.target.dataset.response; }); }
  if(event.target.dataset.fill !== undefined){ await updateResponse((r,q)=>{ if(!r.submitted)r.answer=[...$('response-inputs').querySelectorAll('[data-fill]')].map(input=>input.value); }); }
  if(id==='practice-text') await updateResponse(r=>{if(!r.submitted)r.answer=event.target.value;});
});
document.addEventListener('input',event=>{
  if(event.target.id==='bank-search'){ const value=event.target.value,position=event.target.selectionStart; bankFilter.search=value; render(); $('bank-search').focus(); $('bank-search').setSelectionRange(position,position); }
});
$('file-input').onchange=async event=>{
  const file=event.target.files[0]; if(!file)return;
  try {
    if(file.size>32*1024*1024)throw new Error('JSON 文件超过 32 MB。'); const raw=await file.text(),data=JSON.parse(raw);
    if(data.format==='offline-qbank'){ const incoming=decodeBackup(raw); confirm('恢复完整备份',`备份有 ${incoming.questions.length} 道题目、${incoming.sessions.length} 条练习记录。\n会替换当前本机数据，并保留替换前的恢复副本。`,async()=>{ await writeDocuments([['recovery',clone(state)]]); await commit(incoming,'备份已恢复。'); }); }
    else showIncoming(compileBank(data),'合并题库 JSON');
  } catch(error){toast(`无法导入：${error.message}`);} finally{event.target.value='';}
};
window.addEventListener('hashchange',()=>{aiText='';render();});
async function boot(){
  try { const draft=await readDocument(); state=draft?validateState(draft):compileBank(sourceBank); $('save-state').textContent=draft?'已载入本机数据':'空白框架已就绪'; }
  catch(error){ bootError=`数据未能载入：${error.message}。可以重新导入；原有存储不会自动清空。`; $('save-state').textContent='请检查数据'; }
  render();
}
boot();
