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


// —— P3:右栏折叠规则 / 出件前检查分组 / 命令面板条目 / 向导开关与经典预填文案逐字一致 ——
const { railPhase, railDefaults, railIsOpen, railToggle } = await import('../src/views/rail-fold.js');
const { checkGroups } = await import('../src/views/check-groups.js');
const { paletteItems } = await import('../src/views/palette-items.js');
const { composeReq, NJ_DEFAULT_REQ, NJ_REQ_SWITCHES } = await import('../src/views/newjob-core.js');

await test('右栏折叠:出了件看交付与检查,在写看进度与产物,停了先看停在哪', () => {
  assert.strictEqual(railPhase({ done100:true }), 'delivered');
  assert.strictEqual(railPhase({ hasPrimary:true, halted:true }), 'delivered', '出了 Word 的停止单按出件处理');
  assert.strictEqual(railPhase({ hasPrimary:true, running:true }), 'generating');
  assert.strictEqual(railPhase({ missingWord:true, done100:true }), 'missing');
  assert.strictEqual(railPhase({ waiting:true }), 'waiting');
  assert.strictEqual(railPhase({ halted:true }), 'halted');
  assert.strictEqual(railPhase({ staged:true }), 'preparing');
  assert.strictEqual(railPhase({}), 'generating');
  const d = railDefaults('delivered', { hasHealth:true });
  assert.ok(d.deliver && d.check && !d.progress, '出了件:交付与检查展开,进度折叠');
  const g = railDefaults('generating', {});
  assert.ok(g.progress && g.files && !g.deliver && !g.check, '在写:进度与产物展开');
  assert.ok(!railDefaults('halted', { hasHealth:false }).check && railDefaults('halted', { hasHealth:true }).check, '停了:有质检结论才展开检查');
  assert.ok(railDefaults('preparing', {}).refs, '还没开始:参考资料展开');
});

await test('右栏手动开合只在同一阶段内记忆,阶段一变规则重新接管', () => {
  const St = { railFold: {} };
  const gen = railDefaults('generating', {});
  assert.strictEqual(railIsOpen(St, 'j', 'check', 'generating', gen), false);
  railToggle(St, 'j', 'check', 'generating', gen, null);
  assert.strictEqual(railIsOpen(St, 'j', 'check', 'generating', gen), true, '手动展开生效');
  const del = railDefaults('delivered', {});
  assert.strictEqual(railIsOpen(St, 'j', 'progress', 'delivered', del), false, '换阶段后旧的手动记忆不再作数');
});

await test('出件前检查分组:必办在前给「定向重做」,建议其次,已通过最后;组内顺序不变', () => {
  const gaps = [
    { level:'red', title:'章节「技术方案」字数不足', actions:[{ act:'redo', param:'重写章节「技术方案」' }] },
    { level:'red', title:'逐项详情见《成品质检报告.md》', actions:[{ act:'open_artifact', file:'成品质检报告.md' }] },
    { level:'yellow', title:'也可以对整册不达标章节一起重做' },
    { level:'green', title:'目录完整' },
  ];
  const g = checkGroups(gaps);
  assert.deepStrictEqual(g.map(x => x.key), ['red', 'yellow', 'green']);
  assert.deepStrictEqual(g[0].items.map(x => x.title), gaps.slice(0, 2).map(x => x.title));
  assert.strictEqual(g[0].primary.act, 'open_redo');
  assert.strictEqual(g[1].primary, null);
  assert.deepStrictEqual(checkGroups([]), []);
  assert.strictEqual(checkGroups([{ level:'yellow', actions:[{ act:'open_artifact', file:'模型复核报告.md' }] }])[0].primary.label, '打开模型复核报告');
});

await test('命令面板:任务可搜可切,没有当前任务就不给检查/覆盖,外观与字号可搜中文', () => {
  const calls = [];
  const ctx = { jobs:[{ job_id:'a', name:'清湖片区棚户区改造' }, { job_id:'b', name:'智慧管网' }], active:'',
    stateLabel: () => '已完成', selectJob: id => calls.push('select:' + id), newJob(){}, openAssets(){}, openSettings(){}, checkUpdate(){},
    prefs:{ theme:'system', fontScale:'md' }, setPrefs: p => calls.push('prefs:' + JSON.stringify(p)) };
  const all = paletteItems('', ctx);
  assert.ok(all.some(x => x.key === 'job:a') && !all.some(x => x.key === 'check'));
  const hit = paletteItems('棚户', ctx); assert.strictEqual(hit.length, 1); hit[0].run(); assert.deepStrictEqual(calls, ['select:a']);
  const dark = paletteItems('深色', ctx); assert.ok(dark.length === 1 && dark[0].key === 'theme:dark'); dark[0].run();
  assert.strictEqual(calls[1], 'prefs:{"theme":"dark"}');
  assert.strictEqual(paletteItems('字号', ctx).length, 3);
  const withJob = paletteItems('', { ...ctx, active:'a', canRedo:true, hasResult:true, openCheck(){}, openCoverage(){}, openLog(){}, openFolder(){}, openRedo(){}, toggleResult(){} });
  assert.ok(withJob.some(x => x.key === 'check') && withJob.some(x => x.key === 'redo') && withJob.some(x => x.key === 'result'));
});

await test('向导开关全开时的要求文案与经典预填逐字一致;关一条就少一条并重排序号', () => {
  const legacy = [
    "# 角色",
    "你是有 30 年经验的投标方案专家,负责编写本项目的投标技术方案。",
    "",
    "# 最重要的三条",
    "1. **每一章的小标题必须依据这一章自己的内容现拟**。严禁给所有章节套用同一组小标题——",
    "   评审一眼就能看出是模板灌水,直接失分。两个章节的小标题重复,就是写砸了。",
    "2. **逐条应答招标文件**。技术规格、商务条款、评分办法里的每一条,都要能在标书里找到",
    "   对应的应答段落或表格行;偏离表的条数要和招标条款条数同量级,不能只挑几条象征性地填。",
    "3. **不编造**。我方身份、产品能力、资质案例一律取自素材库,素材里没有的写〔需补充〕。",
    "",
    "# 写法",
    "- 篇幅按招标文件的分量走,写透为准;凑字数的套话、换个说法重复一遍的段落,一律不要。",
    "- 每一段都要有具体信息:具体的做法、参数、时间、责任人、验收口径。",
    "  写不出具体内容的地方,说明素材不够,标〔需补充〕,不要用空话填满。",
    "- 评分办法要求承诺函的(如违约承诺、服务期满后的服务承诺),直接写出完整承诺函正文。",
    "- 资质 / 业绩 / 合同 / 证照:按招标规定的名称建一个章节整块留位,**不要拆成一个资质一个小标题**",
    "  (公司手上都是现成扫描件,实际是整块粘贴,拆碎了没法贴);写清该放什么,留〔此处粘贴:…〕空白位,",
    "  **不要自动插这类图**——插错一张就是造假风险。",
    "- 配图只做一件事:证明我方对某条技术要求或评分点的响应。不为插图而插图。",
    "- 商务和技术偏离表每份必写;另出一份《评标索引》放在整册最前面(评分项|分值|评估标准|对应章节)。",
    "- 语言专业、严谨,不堆形容词。"
  ].join('\n');
  assert.strictEqual(composeReq({}), legacy);
  assert.strictEqual(NJ_DEFAULT_REQ, legacy);
  const noItem = composeReq({ itemized:false });
  assert.ok(!/逐条应答招标文件/.test(noItem) && !/评标索引/.test(noItem) && /1\. \*\*每一章/.test(noItem) && /2\. \*\*不编造/.test(noItem));
  assert.ok(/# 最重要的原则/.test(noItem) && !/# 最重要的三条/.test(noItem));
  const none = composeReq({ freshHeadings:false, itemized:false, noFabrication:false });
  assert.ok(!/最重要/.test(none) && /# 写法/.test(none) && /资质 \/ 业绩/.test(none));
  assert.strictEqual(NJ_REQ_SWITCHES.length, 3);
});

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
