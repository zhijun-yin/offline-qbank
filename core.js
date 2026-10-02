export const VERSION = 1;
export const TYPES = { single: '单选题', multiple: '多选题', boolean: '判断题', fill: '填空题', text: '简答题' };
export const DIFFICULTIES = { easy: '基础', medium: '进阶', hard: '挑战' };
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const emptyState = () => ({ version: VERSION, categories: [], questions: [], sessions: [] });
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
function ensure(condition, message) { if (!condition) throw new Error(message); }
function id(value) { ensure(typeof value === 'string' && idPattern.test(value), '数据标识无效。'); return value; }
function text(value, max = 20000) { ensure(typeof value === 'string' && value.length <= max, '文字字段无效或过长。'); return value; }
function time(value) { ensure(Number.isSafeInteger(value) && value >= 0, '时间字段无效。'); return value; }
function array(value, max) { ensure(Array.isArray(value) && value.length <= max, '数据列表无效或数量过多。'); return value; }
function unique(values) { ensure(new Set(values).size === values.length, '存在重复的数据标识。'); }

export function blankQuestion(categoryId = null) {
  return { id: uid(), type: 'single', status: 'draft', categoryId, difficulty: 'easy', stem: '', options: [{ id: uid(), text: '' }, { id: uid(), text: '' }], answer: null, explanation: '', tags: [], score: 1, createdAt: Date.now(), updatedAt: Date.now() };
}

export function validateQuestion(value, categories = null, forceReady = false) {
  ensure(value && Object.hasOwn(TYPES, value.type), '题型无效。');
  ensure(['draft', 'ready'].includes(value.status), '题目状态无效。');
  ensure(Object.hasOwn(DIFFICULTIES, value.difficulty), '难度无效。');
  const q = { id: id(value.id), type: value.type, status: value.status, categoryId: value.categoryId, difficulty: value.difficulty, stem: text(value.stem), options: [], answer: null, explanation: text(value.explanation), tags: array(value.tags, 20).map(tag => text(tag, 30)), score: value.score, createdAt: time(value.createdAt), updatedAt: time(value.updatedAt) };
  ensure(q.categoryId === null || (id(q.categoryId) && (!categories || categories.has(q.categoryId))), '题目所属分类不存在。');
  ensure(Number.isFinite(q.score) && q.score > 0 && q.score <= 100, '分值必须在 0 到 100 之间。');
  const ready = forceReady || q.status === 'ready';
  if (ready) ensure(q.stem.trim().length > 0, '请先填写题干，再设为可练习。');
  if (['single', 'multiple'].includes(q.type)) {
    q.options = array(value.options, 10).map(option => ({ id: id(option.id), text: text(option.text, 2000) }));
    unique(q.options.map(option => option.id));
    const optionIds = new Set(q.options.map(option => option.id));
    if (ready) ensure(q.options.length >= 2 && q.options.every(option => option.text.trim()), '选择题至少需要两个有内容的选项。');
    if (q.type === 'single') {
      ensure(value.answer === null || optionIds.has(value.answer), '正确答案引用了不存在的选项。');
      q.answer = value.answer;
      if (ready) ensure(q.answer !== null, '请选择一个正确答案。');
    } else {
      q.answer = array(value.answer, 10).map(id); unique(q.answer);
      ensure(q.answer.every(answer => optionIds.has(answer)), '正确答案引用了不存在的选项。');
      if (ready) ensure(q.answer.length > 0, '请勾选正确答案。');
    }
  } else if (q.type === 'boolean') {
    ensure(value.answer === null || typeof value.answer === 'boolean', '判断题答案无效。'); q.answer = value.answer;
    if (ready) ensure(q.answer !== null, '请设置判断题的正确答案。');
  } else if (q.type === 'fill') {
    q.answer = array(value.answer, 10).map(variants => array(variants, 10).map(item => text(item, 500)));
    if (ready) ensure(q.answer.length > 0 && q.answer.every(variants => variants.length && variants.every(item => item.trim())), '请为每个空填写至少一个可接受答案。');
  } else { q.answer = text(value.answer, 10000); }
  return q;
}

export function validateState(value) {
  ensure(value && value.version === VERSION, '不支持这个数据版本。');
  const state = emptyState();
  state.categories = array(value.categories, 500).map(category => ({ id: id(category.id), name: text(category.name, 60), createdAt: time(category.createdAt) }));
  ensure(state.categories.every(category => category.name.trim()), '分类名称不能为空。');
  unique(state.categories.map(category => category.id));
  unique(state.categories.map(category => category.name.trim().toLocaleLowerCase()));
  const categories = new Set(state.categories.map(category => category.id));
  state.questions = array(value.questions, 5000).map(q => validateQuestion(q, categories));
  unique(state.questions.map(q => q.id));
  state.sessions = array(value.sessions, 1000).map(session => {
    ensure(session && ['active', 'completed'].includes(session.status), '练习状态无效。');
    const questions = array(session.questions, 200).map(q => validateQuestion(q, null, true));
    ensure(questions.length > 0, '练习不能没有题目。'); unique(questions.map(q => q.id));
    const responses = array(session.responses, 200);
    ensure(responses.length === questions.length, '作答记录与题目数量不一致。');
    const copy = { id: id(session.id), name: text(session.name, 100), status: session.status, createdAt: time(session.createdAt), finishedAt: session.finishedAt === null ? null : time(session.finishedAt), index: session.index, questions, responses: [] };
    ensure(Number.isInteger(copy.index) && copy.index >= 0 && copy.index < questions.length, '练习位置无效。');
    if (copy.status === 'completed') ensure(copy.finishedAt !== null, '已完成练习缺少完成时间。');
    else ensure(copy.finishedAt === null, '进行中的练习不应带有完成时间。');
    copy.responses = responses.map((response, index) => {
      const q = questions[index]; ensure(response && typeof response.submitted === 'boolean', '作答记录无效。');
      let answer = response.answer;
      if (answer !== null) {
        if (q.type === 'single') ensure(q.options.some(option => option.id === answer), '作答选项不存在。');
        else if (q.type === 'multiple') { answer = array(answer, 10).map(id); unique(answer); ensure(answer.every(item => q.options.some(option => option.id === item)), '作答选项不存在。'); }
        else if (q.type === 'boolean') ensure(typeof answer === 'boolean', '判断作答无效。');
        else if (q.type === 'fill') { answer = array(answer, 10).map(item => text(item, 500)); ensure(answer.length === q.answer.length, '填空作答数量不一致。'); }
        else answer = text(answer, 10000);
      }
      ensure(response.manual === null || (q.type === 'text' && response.submitted && typeof response.manual === 'boolean'), '自评记录无效。');
      return { answer, submitted: response.submitted, manual: response.manual };
    });
    return copy;
  });
  unique(state.sessions.map(session => session.id));
  ensure(state.sessions.filter(session => session.status === 'active').length <= 1, '同时只能有一个进行中的练习。');
  const backupSize = new TextEncoder().encode(JSON.stringify({format:'offline-qbank',version:1,exportedAt:'2000-01-01T00:00:00.000Z',data:state},null,2)).byteLength;
  ensure(backupSize <= 32 * 1024 * 1024, '数据超过 32 MB，请先备份并整理记录。');
  return state;
}

const normalize = value => String(value).normalize('NFKC').trim().toLocaleLowerCase();
export function gradeAnswer(q, response, manual = null) {
  if (q.type === 'text') return manual;
  if (response === null) return false;
  if (q.type === 'single' || q.type === 'boolean') return response === q.answer;
  if (q.type === 'multiple') return Array.isArray(response) && response.length === q.answer.length && new Set(response).size === response.length && q.answer.every(item => response.includes(item));
  if (q.type === 'fill') return Array.isArray(response) && response.length === q.answer.length && q.answer.every((variants, index) => variants.some(item => normalize(item) === normalize(response[index])));
  return null;
}

export function sessionSummary(session) {
  let correct = 0, wrong = 0, pending = 0, skipped = 0, score = 0;
  session.questions.forEach((q, index) => {
    const response = session.responses[index];
    if (!response.submitted) { skipped++; return; }
    const result = gradeAnswer(q, response.answer, response.manual);
    if (result === null) pending++;
    else if (result) { correct++; score += q.score; }
    else wrong++;
  });
  return { total: session.questions.length, correct, wrong, pending, skipped, score, maxScore: session.questions.reduce((sum, q) => sum + q.score, 0) };
}

export function wrongIds(state) {
  const latest = new Map();
  for (const session of [...state.sessions].filter(s => s.status === 'completed').sort((a,b) => a.finishedAt - b.finishedAt)) session.questions.forEach((q,index) => {
    const response = session.responses[index];
    if (!response.submitted) return;
    const result = gradeAnswer(q, response.answer, response.manual);
    if (result !== null) latest.set(q.id, result);
  });
  const present = state.questions ? new Set(state.questions.map(q=>q.id)) : null;
  return new Set([...latest].filter(([id,correct]) => !correct && (!present || present.has(id))).map(([id]) => id));
}

export function selectQuestions(state, filter = {}) {
  const wrong = filter.wrongOnly ? wrongIds(state) : null;
  return state.questions.filter(q => q.status === 'ready' && (!filter.categoryId || q.categoryId === filter.categoryId) && (!filter.type || q.type === filter.type) && (!filter.difficulty || q.difficulty === filter.difficulty) && (!wrong || wrong.has(q.id)));
}

export function createSession(state, filter, count, shuffle = true) {
  if (state.sessions.some(session => session.status === 'active')) throw new Error('请先完成当前练习。');
  if (state.sessions.length >= 1000) throw new Error('练习记录已达上限，请先导出备份并整理记录。');
  const questions = selectQuestions(state, filter).map(clone);
  ensure(Number.isInteger(count) && count >= 1 && count <= 200, '每次练习支持 1 到 200 题。');
  ensure(questions.length >= count, '可练习题目不足，请先添加或导入题目。');
  if (shuffle) for (let i = questions.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i+1)); [questions[i], questions[j]] = [questions[j], questions[i]]; }
  return { id: uid(), name: `练习 ${state.sessions.length + 1}`, status: 'active', createdAt: Date.now(), finishedAt: null, index: 0, questions: questions.slice(0,count), responses: Array.from({ length: count }, () => ({ answer: null, submitted: false, manual: null })) };
}

export function removeCategory(state, categoryId) {
  const next = clone(state); next.categories = next.categories.filter(category => category.id !== categoryId);
  next.questions.forEach(q => { if (q.categoryId === categoryId) q.categoryId = null; });
  return next;
}

export function encodeBackup(state) { return JSON.stringify({ format: 'offline-qbank', version: VERSION, exportedAt: new Date().toISOString(), data: validateState(state) }, null, 2); }
export function decodeBackup(raw) {
  ensure(typeof raw === 'string' && raw.length <= 32 * 1024 * 1024, '备份文件过大。');
  const value = JSON.parse(raw);
  ensure(value && value.format === 'offline-qbank' && value.version === VERSION, '这不是支持的题库备份文件。');
  return validateState(value.data);
}
