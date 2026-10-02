import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, blankQuestion, validateQuestion, validateState, encodeBackup, decodeBackup, gradeAnswer, sessionSummary, wrongIds, createSession, removeCategory } from '../core.js';
import { compileBank, mergeBank } from '../bank.js';
import { buildMessages, callLLM, fetchBank, endpointURL } from '../adapters/api.js';

// Fixtures are empty structural records and grading tokens, not a question bank.
test('a fresh framework contains no content and backups round-trip',()=>{
  const state=emptyState(); assert.deepEqual(state.questions,[]); assert.deepEqual(state.categories,[]); assert.deepEqual(state.sessions,[]);
  assert.deepEqual(decodeBackup(encodeBackup(state)),state);
  assert.deepEqual(compileBank({version:1,categories:[],questions:[]}),state);
  assert.throws(()=>createSession(state,{},1),/不足/);
});
test('blank drafts are allowed, but cannot be marked ready',()=>{
  const q=blankQuestion(); assert.equal(validateQuestion(q).stem,'');
  assert.throws(()=>validateQuestion({...q,status:'ready'}),/题干/);
  assert.throws(()=>validateQuestion({...q,categoryId:'absent'},new Set()),/分类/);
  assert.throws(()=>validateQuestion({...q,score:-1}),/分值/);
  assert.throws(()=>validateQuestion({...q,options:[q.options[0],q.options[0]]}),/重复/);
});
test('category removal preserves records and clears their category reference',()=>{
  const state=emptyState(); state.categories=[{id:'category',name:'classification',createdAt:0}];
  state.questions=[blankQuestion('category')]; const next=removeCategory(state,'category');
  assert.equal(next.questions.length,1); assert.equal(next.questions[0].categoryId,null);
  assert.equal(state.questions[0].categoryId,'category'); assert.doesNotThrow(()=>validateState(next));
});
test('imports reject duplicate identities, corrupt references and unsupported versions',()=>{
  const state=emptyState(); const q=blankQuestion(); state.questions=[q,q]; assert.throws(()=>validateState(state),/重复/);
  assert.throws(()=>decodeBackup('{"format":"offline-qbank","version":99}'));
  assert.throws(()=>compileBank({version:1,categories:[],questions:[{...q,categoryId:'missing'}]}));
  assert.throws(()=>decodeBackup('null'));
});
test('grading works independently of any question text',()=>{
  assert.equal(gradeAnswer({type:'single',answer:'option_a'},'option_a'),true);
  assert.equal(gradeAnswer({type:'single',answer:'option_a'},null),false);
  assert.equal(gradeAnswer({type:'multiple',answer:['a','b']},['b','a']),true);
  assert.equal(gradeAnswer({type:'multiple',answer:['a','b']},['a','a']),false);
  assert.equal(gradeAnswer({type:'boolean',answer:false},false),true);
  assert.equal(gradeAnswer({type:'fill',answer:[['a']]},[' Ａ ']),true);
  assert.equal(gradeAnswer({type:'text'},''),null);
  assert.equal(gradeAnswer({type:'text'},'',false),false);
});
test('summary distinguishes unsubmitted and ungraded records; newer correct attempts clear wrong IDs',()=>{
  const questions=[{id:'a',type:'boolean',answer:true,score:1},{id:'b',type:'text',score:2},{id:'c',type:'single',answer:'x',score:1}];
  const responses=[{answer:false,submitted:true,manual:null},{answer:'',submitted:true,manual:null},{answer:null,submitted:false,manual:null}];
  const session={status:'completed',finishedAt:1,questions,responses};
  assert.deepEqual(sessionSummary(session),{total:3,correct:0,wrong:1,pending:1,skipped:1,score:0,maxScore:4});
  const later={...session,finishedAt:2,responses:[{...responses[0],answer:true},responses[1],responses[2]]};
  assert.equal(wrongIds({sessions:[session]}).has('a'),true);
  assert.equal(wrongIds({sessions:[later,session]}).size,0);
});
test('bank merge updates matching IDs without clearing practice history',()=>{
  const state=emptyState(); state.categories=[{id:'c',name:'before',createdAt:0}];
  const merged=mergeBank(state,compileBank({version:1,categories:[{id:'c',name:'after'}],questions:[]}));
  assert.equal(merged.categories[0].name,'after'); assert.equal(state.categories[0].name,'before');
});
test('API adapter sends the expected chat protocol, hides references from hint requests and parses text',async()=>{
  const material={type:'text',stem:'',options:[],answer:'private-reference',explanation:'private-explanation'};
  const hint=JSON.parse(buildMessages('hint',material)[1].content); assert.equal(hint.referenceAnswer,undefined); assert.equal(hint.explanation,undefined);
  let sent;
  const result=await callLLM({llmEndpoint:'https://api.invalid/chat',model:'test-model',apiKey:'temporary-test-token'},{task:'review',question:material,response:''},async(url,options)=>{
    sent={url,...options}; return new Response(JSON.stringify({choices:[{message:{content:'adapter-ok'}}]}),{status:200});
  });
  assert.equal(result,'adapter-ok'); assert.equal(sent.headers.Authorization,'Bearer temporary-test-token');
  assert.equal(JSON.parse(sent.body).stream,false); assert.equal(JSON.parse(sent.body).model,'test-model');
  assert.equal(JSON.parse(JSON.parse(sent.body).messages[1].content).learnerAnswer,'');
});
test('API errors are bounded and do not echo upstream response bodies',async()=>{
  await assert.rejects(()=>fetchBank({bankEndpoint:'https://api.invalid/bank'},async()=>new Response('sensitive upstream body',{status:401})),error=>error.message.includes('401')&&!error.message.includes('sensitive'));
  await assert.rejects(()=>fetchBank({bankEndpoint:'https://api.invalid/bank',timeoutMs:10},(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))),/超时/);
  for(const url of ['file:///etc/passwd','data:text/plain,x','https://user:password@example.com'])assert.throws(()=>endpointURL(url));
});
