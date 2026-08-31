#!/usr/bin/env node
// 核心层无头冒烟:不开浏览器,直接驱动移植后的状态机,钉住 PARITY.md 里的语义红线。
// 经典前端的这些行为都有真实反馈工单背书,任何一条断了都意味着迁移改变了语义。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let passed = 0, failed = 0;
async function test(name, fn){
  try{ await fn(); passed++; console.log('✓ ' + name); }
  catch(e){ failed++; console.error('✗ ' + name + '\n  ' + (e && e.message)); }
}

// —— 抽取保真:gen/pure.js 的标记块必须与基准 HTML 里的标记块逐字一致 ——
await test('纯逻辑块与经典源码(main+PR#10)逐字一致', () => {
  const grab = s => s.slice(s.indexOf('/* FRONTEND_STABILITY_PURE_START */'),
                            s.indexOf('/* FRONTEND_STABILITY_PURE_END */'));
  const gen = grab(fs.readFileSync(path.join(root, 'src/core/gen/pure.js'), 'utf8'));
  const base = grab(fs.readFileSync(path.join(root, 'tools/baseline-index.html'), 'utf8'));
  assert.ok(gen.length > 5000, '纯块疑似截断');
  assert.strictEqual(gen, base, '抽取产物与基准源码有差异——重跑 tools/extract-core.mjs');
});

// node 里没有 EventSource;桩一个不吐事件的,让 select() 在「在线」用例里也能走 attachES。
globalThis.EventSource = class { constructor(){ this.readyState = 0; } close(){ this.readyState = 2; } };

const core = await import('../src/core/index.js');
const { S, ui, handle, select, taskPresentation, completionGate, wordPresence, knownStep,
        nextStreamState, streamReconnectDelay, recordStreamFailure, markStreamOpen,
        presentProblem, applyHealthUpdate, checkForUpdate, api } = core;

const NOW = () => new Date().toISOString().replace('T',' ').slice(0,19);
const OLD = '2024-01-01 09:00:00';

await test('消息事件:服务端回声与本地即显合并,不出双气泡', () => {
  select('j1');
  (S.msgs.j1 = S.msgs.j1 || []).push({role:'user', text:'改一下页边距', _local:true});
  handle('j1', {type:'message', role:'user', text:'改一下页边距', ts:NOW()});
  const mine = S.msgs.j1.filter(m => m.role==='user' && m.text==='改一下页边距');
  assert.strictEqual(mine.length, 1, '出了双气泡');
  assert.ok(!mine[0]._local, '回声没有替换本地占位');
});

await test('进度事件:历史回放只补数字,不许把已停止改写成运行中', () => {
  S.jobs = [{job_id:'j2', name:'龙华片区', state:'stopped', pct:40}];
  select('j2');
  handle('j2', {type:'progress', stage:'分章撰写', pct:55, step:7, total:12, ts:OLD});
  assert.strictEqual(S.jobs[0].state, 'stopped', '历史回放把状态改活了');
  assert.strictEqual(S.jobs[0].pct, 55, '回放应补进度数字');
  handle('j2', {type:'progress', stage:'分章撰写', pct:60, step:7, total:12, ts:NOW()});
  assert.strictEqual(S.jobs[0].state, 'running', '新鲜事件应把停止态唤醒');
  handle('j2', {type:'progress', stage:'完成', pct:100, step:12, total:12, ts:NOW()});
  assert.strictEqual(S.jobs[0].state, 'done');
  assert.ok(S.msgs.j2.some(m => m.role==='sys' && /第 7\/12 步/.test(m.text)), '步进系统行缺失');
  assert.ok(S.worklog.j2.some(l => /── 第 7 步 · 分章撰写 ──/.test(l)), '工作日志分隔线缺失');
});

await test('提问事件:无选项自动切回答通道,question_closed 收回', () => {
  S.jobs = [{job_id:'j3', name:'开放提问', state:'running'}];
  select('j3');
  handle('j3', {type:'question', id:'q9', text:'项目经理的证书编号是多少?', options:[], ts:NOW()});
  assert.ok(S.chips.j3 && S.chips.j3.qid==='q9');
  assert.strictEqual(S.jobs[0].needs_attention, true);
  assert.strictEqual(S.answering.j3, 'q9', '开放式提问应自动进入回答通道(经典语义:存 qid)');
  handle('j3', {type:'question_closed', id:'q9', ts:NOW()});
  assert.strictEqual(S.chips.j3, null);
  assert.strictEqual(S.jobs[0].needs_attention, false);
  assert.strictEqual(S.answering.j3, null);
});

await test('产物事件:识别正文 Word 并标记 has_word,重复产物不叠加', () => {
  S.jobs = [{job_id:'j4', name:'出件', state:'running'}];
  select('j4');
  handle('j4', {type:'artifact', name:'成品质检报告.md', ts:NOW()});
  handle('j4', {type:'artifact', name:'投标文件_技术标.docx', size_kb:2180, ts:NOW()});
  handle('j4', {type:'artifact', name:'投标文件_技术标.docx', size_kb:2180, ts:NOW()});
  assert.strictEqual(S.arts.j4.filter(a=>/docx$/.test(a.name)).length, 1, '产物去重失效');
  assert.strictEqual(S.jobs[0].has_word, true, '正文 Word 没有标记 has_word');
  assert.strictEqual(wordPresence(S.arts.j4, false), 'ready');
});

await test('PR#10:出了整册 Word 的 failed 任务,措辞是「已出件」不是「未完成」', () => {
  const job = {job_id:'j5', name:'深圳龙华', state:'failed', has_word:true};
  const p = taskPresentation(job, Date.now());
  assert.strictEqual(p.state, 'failed');
  assert.strictEqual(p.currentAction, '已出件 · 提交前有待处理项');
  const bare = taskPresentation({job_id:'j6', state:'failed'}, Date.now());
  assert.strictEqual(bare.currentAction, '任务未完成，已有内容已保存');
});

await test('错误事件:运行中的任务不弹红横幅,真失败才弹', () => {
  S.problems = {};
  S.jobs = [{job_id:'j7', name:'在跑', state:'running'}];
  select('j7');
  handle('j7', {type:'error', text:'某节点超时已自动重试', ts:NOW()});
  assert.ok(!S.problems.j7, '运行中任务不该弹横幅');
  S.jobs = [{job_id:'j8', name:'真失败', state:'failed'}];
  select('j8');
  handle('j8', {type:'error', text:'本地节点连续失败', ts:NOW()});
  assert.ok(S.problems.j8, '失败任务应弹横幅');
  assert.strictEqual(S.problems.j8.title, '任务没有按预期继续');
  assert.ok(S.problems.j8.actions.some(a=>a.act==='diagnose'), '横幅必须带一键诊断');
});

await test('断流状态机:退避 3/4/6/10 秒,3 次失败降级轮询,恢复后 recovered', () => {
  assert.deepStrictEqual([1,2,3,4,9].map(streamReconnectDelay), [3000,4000,6000,10000,10000]);
  S.online = false;                       // 关在线闸,避免真的挂定时器
  S.streamState.j9 = {mode:'idle', failures:0};
  recordStreamFailure('j9'); recordStreamFailure('j9');
  assert.strictEqual(S.streamState.j9.mode, 'reconnecting');
  recordStreamFailure('j9');
  assert.strictEqual(S.streamState.j9.mode, 'polling', '第 3 次失败应降级轮询');
  markStreamOpen('j9');
  assert.strictEqual(S.streamState.j9.mode, 'recovered', '失败后重连成功应先示恢复');
  if(S.recoveredTimers.j9){ clearTimeout(S.recoveredTimers.j9); delete S.recoveredTimers.j9; }
  assert.strictEqual(nextStreamState(S.streamState.j9, 'settled').mode, 'connected');
});

await test('进度不回退:knownStep 取 SSE 实时步与落盘检查点的较大者', () => {
  const job = {flow:{checkpoint:{step:8}}};
  assert.strictEqual(knownStep(job, {step:3}, 12), 8, '重开应用后进度掉回去了');
  assert.strictEqual(knownStep(job, {step:11}, 12), 11);
  const gate = completionGate('done', 100, 'missing');
  assert.ok(gate.missingWord && !gate.complete);
});

await test('select:回放偏移只初始化一次,重进任务不清空既有消息', () => {
  S.online = false;
  select('j10');
  S.msgs.j10.push({role:'agent', text:'留存的消息'});
  S.esOffsets.j10 = 42;
  select('j11'); select('j10');
  assert.strictEqual(S.esOffsets.j10, 42, '重选任务把回放偏移清零了');
  assert.strictEqual(S.msgs.j10.length, 1, '重选任务把消息清空了');
});

await test('api:version_sunset 弹「当前版本已停止支持」全局横幅并透传错误码', async () => {
  S.problems = {}; S.active = null;
  globalThis.fetch = async () => ({ ok:false, status:410, headers:{get:()=>''},
    json: async () => ({error:'请更新到最新版本', code:'version_sunset'}) });
  await assert.rejects(() => api('/v1/jobs'), e => e.code==='version_sunset');
  assert.ok(S.problems._global && S.problems._global.title==='当前版本已停止支持');
});

await test('api:网络失败与超时给不同的话', async () => {
  globalThis.fetch = async () => { throw new Error('boom'); };
  await assert.rejects(() => api('/v1/health'), e =>
    e.code==='NETWORK_ERROR' && /本地服务暂时没有响应/.test(e.message));
  globalThis.fetch = (_, opt) => new Promise((_res, rej) => {
    opt.signal.addEventListener('abort', () => rej(new Error('aborted')));
  });
  await assert.rejects(() => api('/v1/health', {timeoutMs:10}), e =>
    e.code==='REQUEST_TIMEOUT' && /任务不会丢失/.test(e.message));
});

await test('applyHealthUpdate:version_gate=expired 弹持久横幅,updateInfo 落库', () => {
  S.problems = {};
  const info = applyHealthUpdate({version:'0.20.6',
    update:{available:true, latest:'0.21.0', url:'https://github.com/shandianT/bid-dog/releases/latest', notes:'x'},
    version_gate:{mode:'expired', message:'该版本已停用'}});
  assert.strictEqual(info.version, '0.21.0');
  assert.strictEqual(S.updateInfo.version, '0.21.0');
  assert.strictEqual(S.problems._global.title, '当前版本已停止支持');
  assert.ok(S.problems._global.actions.some(a=>a.act==='app_update'));
  const evil = applyHealthUpdate({update:{available:true, latest:'9.9.9', url:'https://evil.example/x'}});
  assert.strictEqual(evil.url, 'https://github.com/shandianT/bid-dog/releases/latest', '非官方下载地址必须被拦回官方页');
});

await test('checkForUpdate:离线时说清原因;已知有新版直接进面板', async () => {
  S.online = false; S.updateInfo = null; S.toastMsg = null;
  await checkForUpdate();
  assert.ok(/本地服务未连接/.test(S.toastMsg.text));
  S.updateInfo = {version:'0.21.0', url:'', notes:''};
  let opened = false; const orig = ui.openUpdatePanel; ui.openUpdatePanel = () => { opened = true; };
  await checkForUpdate();
  ui.openUpdatePanel = orig;
  assert.ok(opened, '已知新版应直接进更新面板');
});

const { answer, rerunJob, errAction } = core;

await test('「我来输入」是切通道不是交答案:不发请求,不出气泡', async () => {
  S.online = true;
  S.jobs = [{job_id:'j12', name:'开放题', state:'running'}];
  select('j12');
  S.chips.j12 = {qid:'q12', options:['A','B'], text:'选哪个?'};
  let called = 0; globalThis.fetch = async () => { called++; throw new Error('不该发请求'); };
  const before = (S.msgs.j12||[]).length;
  await answer('我来输入');
  assert.strictEqual(called, 0, '点「我来输入」不该发任何请求');
  assert.strictEqual((S.msgs.j12||[]).length, before, '不该出用户气泡');
  assert.strictEqual(S.answering.j12, 'q12', '应切进回答通道并记住 qid');
  assert.ok(S.chips.j12, '问题必须保留');
});

await test('答案未送达:问题保留、回答通道不丢,可直接重试', async () => {
  S.online = true;
  select('j13');
  S.jobs = [{job_id:'j13', name:'送达失败', state:'running'}];
  S.chips.j13 = {qid:'q13', options:[], text:'编号?'};
  S.answering.j13 = 'q13';
  globalThis.fetch = async () => { throw new Error('网络断了'); };
  await answer('BJ-2026-001');
  assert.ok(S.chips.j13 && S.chips.j13.qid==='q13', '失败后问题不能被吞掉');
  assert.strictEqual(S.answering.j13, 'q13', '失败后仍在回答通道');
  assert.ok(/答案未送达/.test(S.toastMsg.text));
});

await test('重新生成:成功清幂等键,失败保留旧键防重复起单', async () => {
  select('j14');
  S.jobs = [{job_id:'j14', name:'重跑', state:'failed'}];
  globalThis.fetch = async () => { throw new Error('boom'); };
  await rerunJob(true);
  const kept = S.rerunKeys.j14;
  assert.ok(kept, '失败后必须保留幂等键');
  await rerunJob(true);
  assert.strictEqual(S.rerunKeys.j14, kept, '重试必须复用同一个键');
  globalThis.fetch = async (u) => ({ ok:true, status:200, headers:{get:()=>''},
    json: async () => String(u).endsWith('/rerun') ? {job_id:'j14b'} : [] });
  await rerunJob(true);
  assert.ok(!S.rerunKeys.j14, '成功后应清掉幂等键');
});

await test('引擎发来不认识的动作:当面说不认识,不做死按钮', async () => {
  S.toastMsg = null;
  await errAction('teleport_to_moon', '', '');
  assert.ok(/不认识「teleport_to_moon」/.test(S.toastMsg.text));
});

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
