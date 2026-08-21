#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'app', 'src', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const demoHtml = fs.readFileSync(path.join(root, 'site', 'demo.html'), 'utf8');
const siteAppHtml = fs.readFileSync(path.join(root, 'site', 'app', 'index.html'), 'utf8');
const rustMain = fs.readFileSync(path.join(root, 'app', 'src-tauri', 'src', 'main.rs'), 'utf8');
const tauriConf = JSON.parse(fs.readFileSync(path.join(root, 'app', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8')).version;

let passed = 0;
let failed = 0;
const pendingTests = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`✗ ${name}\n  ${error.message}\n`);
  }
}
function asyncTest(name, fn) {
  pendingTests.push({name, fn});
}
function expectHtml(pattern, message) {
  assert.ok(pattern.test(html), message || `页面源码缺少 ${pattern}`);
}
function rejectHtml(pattern, message) {
  assert.ok(!pattern.test(html), message || `页面源码不应出现 ${pattern}`);
}
function section(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `无法提取源码区段: ${from} → ${to}`);
  return html.slice(a, b);
}

const startMark = '/* FRONTEND_STABILITY_PURE_START */';
const endMark = '/* FRONTEND_STABILITY_PURE_END */';
const start = html.indexOf(startMark);
const end = html.indexOf(endMark);
let pure = null;
if (start >= 0 && end > start) {
  const block = html.slice(start + startMark.length, end);
  const sandbox = {};
  vm.runInNewContext(`${block}\nthis.__pure = {
    isBodyWordArtifact, wordPresence, completionGate, activeClock, eventStreamUrl,
    withDiagnosticAction, healthUpdateInfo, modeFromModel, modeSwitchBlocked, engineConnectionGate,
    publicTaskState: typeof publicTaskState === 'function' ? publicTaskState : null,
    taskGroupOpen: typeof taskGroupOpen === 'function' ? taskGroupOpen : null,
    taskPresentation: typeof taskPresentation === 'function' ? taskPresentation : null,
    taskCapabilities: typeof taskCapabilities === 'function' ? taskCapabilities : null,
    friendlyRuntimeNotice: typeof friendlyRuntimeNotice === 'function' ? friendlyRuntimeNotice : null,
    deliveryViewModel: typeof deliveryViewModel === 'function' ? deliveryViewModel : null,
    diagnosticCheckView: typeof diagnosticCheckView === 'function' ? diagnosticCheckView : null,
    flowConsoleView: typeof flowConsoleView === 'function' ? flowConsoleView : null,
    phaseTimingLabel: typeof phaseTimingLabel === 'function' ? phaseTimingLabel : null,
    nextStreamState: typeof nextStreamState === 'function' ? nextStreamState : null,
    streamReconnectDelay: typeof streamReconnectDelay === 'function' ? streamReconnectDelay : null,
  };`, sandbox);
  pure = sandbox.__pure;
}

test('稳定性纯函数块存在并可由 Node 直接执行', () => {
  assert.ok(pure, '缺少 FRONTEND_STABILITY_PURE 标记或函数');
});

test('内部状态严格收敛为五种用户状态，状态不明只可显示为未完成', () => {
  assert.strictEqual(typeof pure.publicTaskState, 'function', '缺少 publicTaskState');
  const cases = [
    [{state:'staged'}, 'preparing'],
    [{state:'running'}, 'generating'],
    [{state:'running', presentation:{needs_attention:true}}, 'needs_input'],
    [{state:'paused'}, 'needs_input'],
    [{state:'done', has_word:true, delivery:{state:'ready'}}, 'completed'],
    [{state:'done', has_word:true, delivery:{state:'needs_attention'}}, 'needs_input'],
    [{state:'stopped'}, 'failed'],
    [{state:'unknown'}, 'failed'],
    [{state:'done', has_word:false}, 'failed'],
  ];
  for(const [job, expected] of cases) assert.strictEqual(pure.publicTaskState(job), expected, JSON.stringify(job));
  const labels = cases.map(([job]) => pure.taskPresentation(job, Date.parse('2026-08-08T12:00:00Z')).label);
  assert.deepStrictEqual([...new Set(labels)].sort(), ['准备中','已完成','未完成','生成中','需要你确认'].sort());
  assert.ok(!labels.some(label => /状态不明|执行外壳|OpenCode|CLI/i.test(label)));
});

test('任务分组首次打开高关注三组，完成和未完成折叠，用户选择跨轮询保持', () => {
  assert.strictEqual(typeof pure.taskGroupOpen,'function');
  for(const key of ['preparing','generating','needs_input']) assert.strictEqual(pure.taskGroupOpen(key,{},false),true,key);
  for(const key of ['completed','failed']) assert.strictEqual(pure.taskGroupOpen(key,{},false),false,key);
  assert.strictEqual(pure.taskGroupOpen('generating',{generating:false},false),false);
  assert.strictEqual(pure.taskGroupOpen('completed',{completed:true},false),true);
  assert.strictEqual(pure.taskGroupOpen('failed',{failed:false},true),true);
});

test('任务呈现包含当前动作、最后活动与 ETA，兼容新旧后端字段', () => {
  assert.strictEqual(typeof pure.taskPresentation, 'function', '缺少 taskPresentation');
  const now = Date.parse('2026-08-08T12:00:00Z');
  const modern = pure.taskPresentation({
    state:'running', stage:'分章撰写',
    presentation:{display_state:'generating', current_action:'正在撰写技术方案', last_activity_at:'2026-08-08T11:58:00Z', eta_seconds:600}
  }, now);
  assert.strictEqual(modern.label, '生成中');
  assert.match(modern.currentAction, /撰写技术方案/);
  assert.match(modern.lastActivity, /2 分钟前/);
  assert.match(modern.eta, /约 10 分钟/);
  const legacy = pure.taskPresentation({state:'unknown', stage:'已停止（连接中断）', created_at:'2026-08-08T11:00:00Z'}, now);
  assert.strictEqual(legacy.label, '未完成');
  assert.ok(!/状态不明|执行外壳|OpenCode|CLI/i.test([legacy.currentAction, legacy.lastActivity, legacy.eta].join(' ')));
  const contract = pure.taskPresentation({
    state:'running', presentation:{code:'generating',label:'生成中'}, status:'active',
    current_action:'正在核对评分条款', last_activity_at:'2026-08-08T11:59:00Z', eta:180
  }, now);
  assert.strictEqual(contract.state, 'generating');
  assert.match(contract.currentAction, /评分条款/);
  assert.match(contract.lastActivity, /1 分钟前/);
  assert.match(contract.eta, /3 分钟/);
});

test('稳定模式能力会关闭暂停并给出用户说明', () => {
  assert.strictEqual(typeof pure.taskCapabilities, 'function', '缺少 taskCapabilities');
  const modern = pure.taskCapabilities({capabilities:{pause:false, live_instruction:false}, presentation:{mode:'stable'}});
  assert.strictEqual(modern.pause, false);
  assert.match(modern.pauseReason, /稳定模式|暂不支持暂停/);
  const legacy = pure.taskCapabilities({state:'running', can:['pause','stop']});
  assert.strictEqual(legacy.pause, true);
  const contract = pure.taskCapabilities({state:'running', runtime:{mode:'compatibility',capabilities:{
    pause:{enabled:false,reason:'稳定模式需保持本轮连续运行'}
  }}});
  assert.strictEqual(contract.pause, false);
  assert.match(contract.pauseReason, /稳定模式|连续运行/);
});

test('运行方式回落只显示友好文案，技术原因留在诊断详情', () => {
  assert.strictEqual(typeof pure.friendlyRuntimeNotice, 'function', '缺少 friendlyRuntimeNotice');
  const notice = pure.friendlyRuntimeNotice({
    type:'message', text:'⚠ 执行外壳起来了但链路没通(执行外壳探活 90 秒没有完整回复),这一单改用兼容模式跑。'
  });
  assert.strictEqual(notice.text, '主连接响应较慢，已切换稳定通道继续；仍使用同一模型和同一套要求，不会降低内容标准。');
  assert.match(notice.technicalDetail, /90 秒/);
  assert.ok(!/执行外壳|OpenCode|CLI|探活|兼容模式/i.test(notice.text));
  assert.strictEqual(notice.action.label, '查看原因');
});

test('一键诊断按 status 正确显示通过、提醒和失败', () => {
  assert.strictEqual(pure.diagnosticCheckView({status:'pass'}).symbol,'✓');
  assert.strictEqual(pure.diagnosticCheckView({status:'warning'}).symbol,'△');
  assert.strictEqual(pure.diagnosticCheckView({status:'fail'}).symbol,'✗');
  assert.strictEqual(pure.diagnosticCheckView({ok:false}).symbol,'✗');
});

test('交付视图以主 Word 和三项检查为核心，并对缺失数据使用未知而非伪通过', () => {
  assert.strictEqual(typeof pure.deliveryViewModel, 'function', '缺少 deliveryViewModel');
  const vm = pure.deliveryViewModel({delivery:{
    primary_word:{name:'投标文件_技术标.docx', size_kb:2048},
    checks:{toc:{state:'pass'}, deviations:{state:'warn', deviation_rows:72, score_rows:95}, quality:{state:'pass'}}
  }}, []);
  assert.strictEqual(vm.primary.name, '投标文件_技术标.docx');
  assert.strictEqual(vm.toc.state, 'pass');
  assert.match(vm.deviations.detail, /72\/95/);
  assert.strictEqual(vm.quality.state, 'pass');
  const unknown = pure.deliveryViewModel({has_word:true}, [{name:'投标文件_技术标.docx', size_kb:10}]);
  assert.strictEqual(unknown.toc.state, 'unknown');
  assert.strictEqual(unknown.deviations.state, 'unknown');
  assert.strictEqual(unknown.quality.state, 'unknown');
  const contract = pure.deliveryViewModel({delivery:{
    word:{present:true,name:'响应文件.docx',url:'/download/word'}, ready:true,
    toc:{status:'pass'}, deviations:{status:'warn',technical:{present:true,rows:72},business:{present:false,rows:0},total_rows:72},
    checks:{status:'pass',level:'green',summary:'格式与内容检查通过'}
  }}, []);
  assert.strictEqual(contract.primary.name, '响应文件.docx');
  assert.strictEqual(contract.toc.state, 'pass');
  assert.match(contract.deviations.detail, /技术表 已检测 · 72 条/);
  assert.match(contract.deviations.detail, /商务表 缺失/);
  assert.doesNotMatch(contract.deviations.detail, /\[object Object\]/);
  assert.strictEqual(contract.quality.state, 'pass');
});

test('已完成或待确认任务有交付优先主视图，过程与诊断退居二级', () => {
  expectHtml(/id="resultView"/);
  expectHtml(/id="resultWord"/);
  expectHtml(/id="resultChecks"/);
  expectHtml(/id="resultOpen"[^>]*>打开</);
  expectHtml(/id="resultDownload"[^>]*>下载|id="resultDownload"[^>]*>另存为/);
  expectHtml(/id="resultModify"[^>]*>继续修改</);
  expectHtml(/id="resultUsage"/);
  expectHtml(/交付结果/);
  expectHtml(/过程与诊断/);
  const main = section('function renderMain()', '/* ================= 任务列表');
  assert.ok(/resultView/.test(main), 'renderMain 没有按任务状态切换交付结果视图');
  assert.ok(/publicTaskState/.test(main), '结果视图切换没有使用五态模型');
});

test('首次使用只呈现 Key、测试连接、上传文件三步', () => {
  const onboarding = section('<!-- FIRST_RUN_START -->', '<!-- FIRST_RUN_END -->');
  for(const label of ['填写 Key','测试连接','上传文件']) assert.match(onboarding, new RegExp(label));
  for(const technical of ['Base URL','OpenCode','Codex','执行外壳','模型 ID'])
    assert.doesNotMatch(onboarding, new RegExp(technical, 'i'));
  assert.doesNotMatch(onboarding, /\bCLI\b/i);
  expectHtml(/id="onboarding"/);
  expectHtml(/id="obKey"/);
  expectHtml(/function showOnboarding\(/);
  expectHtml(/function onboardingConnect\(/);
  expectHtml(/api\('\/v1\/setup'\)/);
  expectHtml(/\/v1\/setup\/connect/);
  expectHtml(/\/v1\/setup\/complete/);
  const setup = section('async function showOnboarding(force)', '/* ================= 视图切换');
  assert.match(setup, /setup_complete|completed|needs_setup|status/);
});

test('新建任务 V2 采用主件、模板项目、素材确认三步并折叠补充要求', () => {
  const newJob = section('<div class="sheet" id="newjob"', '<div class="sheet" id="redo"');
  for(const label of ['主件','模板与项目','素材确认']) assert.match(newJob, new RegExp(label));
  assert.match(newJob, /id="njTemplate"/);
  assert.match(newJob, /政府采购/);
  assert.match(newJob, /工程施工/);
  assert.match(newJob, /服务类投标/);
  assert.match(newJob, /id="njProject"/);
  assert.match(newJob, /<details[^>]*id="njExtra"/);
  expectHtml(/template_id/);
  expectHtml(/project_id/);
});

test('批量管理以归档、重跑、导出、项目为主，删除只在更多操作里', () => {
  const tasks = section('function taskRow(j, compact)', '/* ================= 选择任务 + SSE');
  for(const action of ['archive','rerun','export','project'])
    assert.match(tasks, new RegExp('data-task-bulk-action=["\\\']'+action));
  assert.match(tasks, /更多操作/);
  assert.match(tasks, /data-task-more/);
  assert.doesNotMatch(tasks, /class="del"[^>]*title="删除任务"/, '任务行不应继续直接暴露删除叉号');
  expectHtml(/function archiveJob\(/);
  expectHtml(/function runBulkTaskAction\(/);
});

test('归档是完整视图：可查看、恢复和批量恢复', () => {
  expectHtml(/id="taskScope"/);
  expectHtml(/data-task-scope="active"/);
  expectHtml(/data-task-scope="archived"/);
  expectHtml(/\/v1\/jobs\?scope=archived/);
  expectHtml(/function restoreJob\(/);
  const tasks = section('function taskRow(j, compact)', '/* ================= 选择任务 + SSE');
  assert.match(tasks, /data-restore/);
  assert.match(tasks, /action==='restore'/);
  assert.match(tasks, /data-task-bulk-action="restore"/);
});

test('任务侧栏支持项目筛选并在任务行显示项目标签', () => {
  expectHtml(/id="taskProjectFilter"/);
  expectHtml(/function setTaskProjectFilter\(/);
  expectHtml(/S\.projectFilter/);
  const tasks = section('function taskRow(j, compact)', '/* ================= 选择任务 + SSE');
  assert.match(tasks, /project-tag/);
});

test('自定义模板可保存和删除，内置模板不可删', () => {
  expectHtml(/id="njTemplateName"/);
  expectHtml(/id="njTemplateDelete"/);
  expectHtml(/function saveCurrentTemplate\(/);
  expectHtml(/function deleteSelectedTemplate\(/);
  expectHtml(/method:'POST'[\s\S]{0,220}\/v1\/templates|\/v1\/templates[\s\S]{0,220}method:'POST'/);
  expectHtml(/method:'DELETE'/);
  const templateFns = section('async function loadJobTemplates()', 'function njReset()');
  assert.match(templateFns, /government|construction|service|auto/);
});

test('可以上传优秀标书生成并预览场景模板草稿', () => {
  expectHtml(/id="njTemplateImport"/);
  expectHtml(/function deriveTemplateFromFile\(/);
  expectHtml(/\/v1\/templates\/derive/);
  expectHtml(/模板草稿|模板预览/);
  expectHtml(/评分响应|材料槽位|质检规则/);
  expectHtml(/查看完整设计思路/);
  expectHtml(/id=\"njDerivedOutline\"/);
  expectHtml(/validation\|\|\{\}\)\.ready/);
});

test('自动推荐只做非阻塞预览，建任务由后端权威选择并防止旧请求回写', () => {
  const recommend = section('async function recommendTemplateForTender()', 'async function deriveTemplateFromFile');
  assert.match(recommend, /scene_hint/);
  assert.match(recommend, /recommendSeq/);
  const start = section('async function njStart(startNow)', 'async function startStaged');
  assert.match(start, /recommendTemplateForTender\(\)/);
  assert.doesNotMatch(start, /await recommendTemplateForTender\(\)/);
  assert.match(start, /if\(NJ\.starting\)return/);
  assert.ok(start.indexOf('NJ.starting=true') < start.indexOf('recommendTemplateForTender()'), '重复提交锁必须先于异步推荐');
  const save = section('async function saveCurrentTemplate()', 'async function deleteSelectedTemplate');
  assert.match(save, /NJ\.recommendation/);
  assert.match(save, /template_id\|\|'government'/);
  assert.ok(!/base_template_id:base,config:/.test(save), '不应再发送后端不识别的 config 字段');
});

test('批量操作呈现成功/失败汇总，部分失败进入持久问题卡', () => {
  const bulk = section('async function runBulkTaskAction(action)', 'function runTaskRowAction');
  assert.match(bulk, /succeeded|success_count/);
  assert.match(bulk, /failed|failure_count/);
  assert.match(bulk, /presentProblem/);
});

test('归档、导出、项目、停止和修改失败不会只显示瞬时 toast', () => {
  for(const [from,to] of [
    ['async function archiveJob(id)', 'async function exportJobs(ids)'],
    ['async function exportJobs(ids)', 'function openProjectMove(ids)'],
    ['async function applyProjectMove()', 'async function runBulkTaskAction(action)'],
    ['async function stopJob()', 'function openRevision()'],
    ['async function doRedo()', 'async function openLog()'],
  ]) assert.match(section(from,to), /presentProblem/, `${from} 缺少持久问题卡`);
});

test('关键错误使用持久操作卡，并提供一键诊断与查看原因', () => {
  expectHtml(/id="problemHost"/);
  expectHtml(/id="diagnosticSheet"/);
  expectHtml(/function presentProblem\(/);
  expectHtml(/function runDiagnostics\(/);
  expectHtml(/show_detail/);
  const handle = section('function handle(id, e)', 'async function refreshArts');
  assert.match(handle, /friendlyRuntimeNotice/);
  assert.match(handle, /presentProblem/);
});

test('桌面、在线体验与站点应用三个前端副本保持完全一致', () => {
  assert.strictEqual(demoHtml, html, 'site/demo.html 与桌面前端发生漂移');
  assert.strictEqual(siteAppHtml, html, 'site/app/index.html 与桌面前端发生漂移');
});

test('只有正文 Word 才能宣告完成', () => {
  assert.ok(pure);
  assert.strictEqual(pure.wordPresence([], false), 'unknown');
  assert.strictEqual(pure.wordPresence([], false, true), 'ready');
  assert.strictEqual(pure.wordPresence([], false, false), 'missing');
  assert.strictEqual(pure.wordPresence([{name: '招标文件_解析版.md'}], true), 'missing');
  assert.strictEqual(pure.wordPresence([{name: '投标文件自检报告.docx', size_kb: 18}], true), 'missing');
  assert.strictEqual(pure.wordPresence([{name: '报价附件.docx', size_kb: 18}], true), 'missing');
  assert.strictEqual(pure.wordPresence([{name: '投标文件_技术标.docx', size_kb: 0}], true), 'missing');
  assert.strictEqual(pure.wordPresence([{name: '投标文件_技术标.docx'}], true), 'ready');
  assert.strictEqual(pure.completionGate('done', 100, 'missing').missingWord, true);
  assert.strictEqual(pure.completionGate('done', 100, 'missing').complete, false);
  assert.strictEqual(pure.completionGate('done', 100, 'ready').complete, true);
  assert.strictEqual(pure.completionGate('running', 100, 'ready').complete, false);
  const head = section('function renderHead()', 'function renderQuick(');
  const rail = section('function renderRail()', "el('files').addEventListener");
  expectHtml(/没出 Word，未完成/);
  assert.ok(/completionGate/.test(head), '头部没有接入 Word 交付闸门');
  assert.ok(/done100\s*=\s*delivery\.complete/.test(rail), '右栏仍可能仅凭 pct 全部打勾');
  rejectHtml(/if\s*\(e\.pct\s*>=\s*100\)\s*notify\(['"]已出 Word/);
});

test('活跃时长去重、长间隔封顶十分钟、终态不随墙钟增长', () => {
  assert.ok(pure);
  const minute = 60 * 1000;
  const startAt = 1_000_000;
  const times = [startAt, startAt + 5 * minute, startAt + 5 * minute,
    startAt + 30 * 60 * minute + 5 * minute, startAt + 30 * 60 * minute + 9 * minute];
  const terminal = pure.activeClock(times, startAt + 100 * 60 * minute, true);
  assert.strictEqual(terminal.active, 19 * minute);
  assert.strictEqual(terminal.idle, (30 * 60 - 10) * minute);
  const muchLater = pure.activeClock(times, startAt + 1000 * 60 * minute, true);
  assert.strictEqual(muchLater.active, terminal.active);
  assert.strictEqual(muchLater.idle, terminal.idle);
  const running = pure.activeClock([startAt], startAt + 30 * minute, false);
  assert.strictEqual(running.active, 10 * minute);
  assert.strictEqual(running.idle, 20 * minute);
  const timing = section('function timing(id)', '/* ================= 头部 / 对话 / 快捷');
  assert.ok(/activeClock\(times/.test(timing), '页面 timing() 没有使用活跃时钟');
  expectHtml(/eventTimes/);
});

test('SSE 续传 URL 使用编码任务号和 offset', () => {
  assert.ok(pure);
  assert.strictEqual(
    pure.eventStreamUrl('http://127.0.0.1:8848', '任务/a b', 17),
    'http://127.0.0.1:8848/v1/jobs/%E4%BB%BB%E5%8A%A1%2Fa%20b/events?offset=17'
  );
  const attach = section('function attachES(id, reconnecting)', 'function eventIsRecent');
  expectHtml(/esOffsets/);
  expectHtml(/attachES\(id,\s*true\)/);
  assert.ok(/eventStreamUrl\(API, id, offset\)/.test(attach), 'EventSource 没有使用 offset URL');
  assert.ok(!/S\.msgs\[id\]\s*=\s*\[\]/.test(attach), '断线重连仍会清空消息');
  assert.ok(/parsed\._cursor/.test(attach), '重连后没有使用服务端精确 cursor');
  assert.ok(/parsed\.type==='stream_reset'/.test(attach), '事件日志重建后没有自动重置会话回放');
});

test('重跑和问题回答在会话抖动时不会重复派发或丢失问题', () => {
  const rerun = section('async function rerunJob(skipAsk)', 'function renderWorklog');
  assert.ok(/S\.rerunBusy\[sourceId\]/.test(rerun), '重跑没有前端原子防重入');
  assert.ok(/Idempotency-Key/.test(rerun), '重跑没有会话级幂等键');
  const answer = section('async function answer(choice)', 'function addLocal');
  assert.ok(/result&&result\.ok===false/.test(answer), '回答链路没有检查后端未送达结果');
  assert.ok(/S\.chips\[id\]=q/.test(answer), '回答失败后没有恢复待回答问题');
});

test('六段流程台只展示后端证据并兼容旧任务', () => {
  assert.strictEqual(typeof pure.flowConsoleView, 'function', '缺少流程台纯函数');
  const view = pure.flowConsoleView({
    current_phase:'parse', current_action:'正在提取目录', recoverable:true,
    checkpoint:{step:1,label:'体检素材'},
    phases:[
      {id:'environment',label:'环境准备',state:'done',detail:'已验证完成',evidence:'preflight.json'},
      {id:'parse',label:'招标解析',state:'active',detail:'正在提取目录',evidence:'组成与格式规范',
        elapsed_seconds:270,expected_seconds:480,remaining_seconds:210,estimate_source:'reference'},
      {id:'plan',label:'响应规划',state:'pending'}, {id:'write',label:'并行撰写',state:'pending'},
      {id:'assemble',label:'Word 装配',state:'pending'}, {id:'deliver',label:'交付质检',state:'pending'},
    ],
  }, {mode:'polling',failures:3});
  assert.deepStrictEqual(Array.from(view.phases, x=>x.label), ['环境准备','招标解析','响应规划','并行撰写','Word 装配','交付质检']);
  assert.strictEqual(view.connectionLabel, '轮询保障中');
  assert.strictEqual(view.checkpoint, '已完成：体检素材');
  assert.strictEqual(view.recoverable, true);
  assert.strictEqual(view.phases[1].state, 'active');
  assert.strictEqual(typeof pure.phaseTimingLabel, 'function', '缺少阶段耗时文案函数');
  assert.strictEqual(pure.phaseTimingLabel(view.phases[1]), '已用 4分30秒 · 通常 8分钟 · 预计还需 3分30秒');
  const legacy = pure.flowConsoleView(null, {mode:'idle'}, {step:7,stage:'分章撰写'});
  assert.strictEqual(legacy.phases.length, 6);
  assert.strictEqual(legacy.phases[3].state, 'active');
});

test('事件流第三次断开进入轮询保障，恢复后回到实时连接', () => {
  assert.strictEqual(typeof pure.nextStreamState, 'function', '缺少连接状态机');
  let state = {mode:'connected',failures:0};
  state = pure.nextStreamState(state, 'error');
  assert.deepStrictEqual({mode:state.mode,failures:state.failures},{mode:'reconnecting',failures:1});
  state = pure.nextStreamState(state, 'error');
  assert.strictEqual(state.mode, 'reconnecting');
  state = pure.nextStreamState(state, 'error');
  assert.deepStrictEqual({mode:state.mode,failures:state.failures},{mode:'polling',failures:3});
  assert.deepStrictEqual([1,2,3,8].map(pure.streamReconnectDelay),[3000,4000,6000,10000]);
  state = pure.nextStreamState(state, 'open');
  assert.deepStrictEqual({mode:state.mode,failures:state.failures},{mode:'recovered',failures:0});
  const attach = section('function attachES(id, reconnecting)', 'function eventIsRecent');
  assert.ok(/recordStreamFailure\(id\)/.test(attach), 'SSE 错误没有进入统一状态机');
  expectHtml(/function startJobPolling\(/);
  expectHtml(/function clearStreamRecovery\(/);
  const polling = section('function startJobPolling(id)', 'function clearStreamRecovery');
  assert.ok(/S\.active\s*!==\s*id/.test(polling), '已切走的任务仍可能遗留轮询定时器');
  rejectHtml(/startJobPolling[\s\S]{0,500}\/v1\/jobs\/[^'"`]+\/(?:rerun|resume|start)/,
    '轮询保障不应启动、重跑或继续任务');
});

test('所有错误动作末尾都有且只有一个诊断包入口', () => {
  assert.ok(pure);
  const actions = pure.withDiagnosticAction([{act: 'rerun', label: '重跑'}, {act: 'bundle', label: '旧入口'}]);
  assert.strictEqual(actions.filter(a => a.act === 'bundle').length, 1);
  assert.strictEqual(actions[actions.length - 1].act, 'bundle');
  assert.strictEqual(actions[actions.length - 1].label, '导出诊断包');
  const handle = section('function handle(id, e)', 'async function refreshArts');
  const actionHandler = section('async function errAction', '/* ================= 右栏卡片');
  assert.ok(/withDiagnosticAction\(e\.actions\)/.test(handle), 'error 事件没有自动追加诊断入口');
  assert.ok(/act==='bundle'/.test(actionHandler) && /\/bundle/.test(html), '诊断包动作没有接到下载接口');
  expectHtml(/\/bundle\/save/);
});

test('升级信息仅在确有新版本时出现', () => {
  assert.ok(pure);
  assert.strictEqual(pure.healthUpdateInfo({update: {status: 'pending'}}), null);
  assert.strictEqual(pure.healthUpdateInfo({update: {status: 'latest', latest: '0.19.6'}}), null);
  const info = pure.healthUpdateInfo({update: {status: 'available', latest: '0.18.3', url: 'https://github.com/shandianT/bid-dog/releases/tag/desktop-v0.18.3'}});
  assert.strictEqual(info.version, '0.18.3');
  assert.match(info.url, /^https:\/\/github\.com\/shandianT\/bid-dog\/releases\//);
  expectHtml(/function pollHealthUpdate\(/);
  expectHtml(/id="updateLink"/);
  expectHtml(/\/v1\/open_release/);
});

test('标准/极速按实际模型回填，活跃任务阻止全局切模', () => {
  assert.ok(pure);
  assert.strictEqual(pure.modeFromModel('senseaudio-s2'), 'quality');
  assert.strictEqual(pure.modeFromModel('deepseek-v4-flash'), 'fast');
  assert.strictEqual(pure.modeFromModel('unknown-model'), null);
  assert.strictEqual(pure.modeSwitchBlocked([{state: 'done'}]), false);
  assert.strictEqual(pure.modeSwitchBlocked([{state: 'running'}]), true);
  assert.strictEqual(pure.modeSwitchBlocked([{state: 'paused'}]), true);
  const loadAgent = section('async function loadAgent()', 'const QK_MODES');
  const switcher = section('let QK_SWITCH_SEQ', 'async function qkVerify');
  assert.ok(/class="seg on" data-mode="fast"/.test(html), '首次打开没有默认选中极速模式');
  assert.ok(/let QK_MODE\s*=\s*'fast'/.test(html), '快速接入没有默认使用极速模式');
  assert.ok(/setup\/connect[\s\S]{0,240}mode:'fast'/.test(html), '首次接入没有把极速模式提交给引擎');
  expectHtml(/QK_SWITCH_SEQ/);
  assert.ok(/modeFromModel\(eff\)/.test(loadAgent) && /setQkMode\(actualMode\)/.test(loadAgent), '实际模型没有回填到模式按钮');
  assert.ok(/QK_SWITCH_QUEUE/.test(switcher) && /\/v1\/agent\/test/.test(switcher), '模式切换没有串行并真实探活');
  assert.ok(/Promise\.all\(\[api\('\/v1\/agent'\), api\('\/v1\/jobs'\)\]\)/.test(switcher), '切换前没有刷新实际任务状态');
  assert.ok(/oldPayload/.test(switcher) && /已恢复原模式/.test(switcher), '模式切换失败没有回滚');
  assert.ok(/setQkMode\(previousMode\)[\s\S]*await loadAgent\(\)/.test(switcher), '失败后没有以服务端真实状态最终回填');
  expectHtml(/模式未切换/);
});

test('旧引擎自动接管期间不提交模型设置也不误报已保存', () => {
  assert.strictEqual(typeof pure.engineConnectionGate, 'function', '缺少引擎接管状态判断');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(pure.engineConnectionGate(false, '0.19.1'))),
    {ready:false, switching:true, message:'检测到旧版本地引擎，正在安全切换到新版；若旧任务仍在收尾，完成后会自动连接。Key 尚未提交或保存。'}
  );
  assert.strictEqual(pure.engineConnectionGate(false, null).ready, false);
  assert.strictEqual(pure.engineConnectionGate(true, null).ready, true);
  const quick = section('async function quickS2()', 'async function saveAgent');
  const boot = section('async function boot()', 'function setOnboardingStep');
  assert.ok(/engineConnectionGate\(S\.online,\s*S\.stale\)/.test(quick), '一键接入前没有阻断旧引擎接管状态');
  assert.ok(/正在安全切换到新版/.test(html), '界面没有告诉用户会自动完成接管');
  assert.ok(/await\s+goOnline\(h\)/.test(boot), '自动接管成功后应原地连接，保留尚未提交的 Key');
  assert.ok(!/location\.reload\(\)/.test(boot), '接管后刷新页面会丢失尚未提交的 Key');
});

test('现有 OpenCode 与 Codex 回退入口没有被 v56 覆盖', () => {
  expectHtml(/<option value="claude">Claude Code<\/option>/);
  expectHtml(/<option value="codex">Codex CLI<\/option>/);
  expectHtml(/a\.opencode_bundled/);
  expectHtml(/available\s*&&\s*a\.available\.opencode/);
  rejectHtml(/k==='s2'\s*\?\s*'codex'/);
});

test('桌面版只连接当前版本专属引擎，不复用旧版驻留进程', () => {
  const connection = section('const IS_WEB', 'let S =');
  const escapedVersion = appVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.ok(new RegExp(`BUNDLED_ENGINE_VERSION\\s*=\\s*['"]${escapedVersion}['"]`).test(connection), '桌面端没有钉住当前引擎版本');
  assert.ok(/DESKTOP_ENGINE\s*=\s*'http:\/\/127\.0\.0\.1:18901'/.test(connection), '桌面端没有使用版本专属端口');
  assert.ok(/IS_WEB\s*\?\s*\[location\.origin\]\s*:\s*\[DESKTOP_ENGINE\]/.test(connection), '桌面端仍会探测历史端口');
  assert.ok(!/8849|8848|8080/.test(connection), '连接候选仍含历史引擎端口');
  assert.ok(/h\.version\s*===\s*BUNDLED_ENGINE_VERSION/.test(html), '健康检查没有拒绝错误版本');
  assert.ok(/const ENGINE_PORT:\s*u16\s*=\s*18901;/.test(rustMain), 'Tauri 启动端口与前端不一致');
});

test('覆盖安装时 WebView 不复用旧前端缓存或历史引擎地址', () => {
  const mainWindow = (((tauriConf || {}).app || {}).windows || [])[0] || {};
  const launchUrl = String(mainWindow.url || '');
  const failures = [];
  if(mainWindow.incognito !== true) failures.push('主窗口必须启用 incognito=true 隔离旧 WebView 缓存');
  if(!launchUrl.includes(appVersion) || !/18901/.test(launchUrl))
    failures.push(`主窗口 URL 必须同时包含版本 ${appVersion} 与专属端口 18901 作为缓存版本戳`);
  if(!/localStorage\.removeItem\(\s*['"]bid_api['"]\s*\)/.test(html))
    failures.push('新前端启动时必须清除历史 localStorage.bid_api');
  if(/localStorage\.getItem\(\s*['"]bid_api['"]\s*\)/.test(html))
    failures.push('新前端不得再读取历史 localStorage.bid_api 选择引擎');
  assert.strictEqual(failures.length, 0, failures.join('；'));
});

test('桌面壳先迁移旧品牌数据目录，并把同一路径显式交给内置引擎', () => {
  assert.ok(/join\("标书助手"\)/.test(rustMain), 'Rust 壳没有识别旧品牌数据目录');
  assert.ok(/fs::rename\([^;]+\)/s.test(rustMain), 'Rust 壳没有在创建新目录前迁移旧数据');
  assert.ok(/cmd\.env\("BID_HOME",\s*&?data\)/.test(rustMain), '内置引擎没有显式复用壳层选定的数据目录');
});

test('桌面通知只由原生壳发送，网页体验才使用 Web Notification', () => {
  const notifySource = section('function notify(t)', '/* ================= 弹层');
  assert.match(notifySource, /IS_WEB/);
  const newJob = section('async function njStart(startNow)', 'async function startStaged');
  assert.match(newJob, /IS_WEB\s*&&\s*!FORCE_DEMO/);
});

test('任务列表严格使用五种用户状态，完成与未完成组可折叠且重渲染不丢状态', () => {
  const taskSource = section('function renderTasks()', 'async function delJob');
  const tasks = {
    innerHTML: '',
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; }
  };
  const jobs = [];
  for(let i=0;i<9;i++) jobs.push({job_id:`failed-${i}`, name:`failed ${i}`, state:'unknown'});
  for(let i=0;i<5;i++) jobs.push({job_id:`done-${i}`, name:`done ${i}`, state:'done',has_word:true});
  jobs.push({job_id:'running-0',name:'running',state:'running'});
  const sandbox = {
    S: {jobs, archivedJobs:[],taskScope:'active',projectFilter:'',active:'done-0', prog:{}, taskGrpOpen:{generating:true},taskBulkMode:false,taskBulkDeleting:false,taskBulkBusy:false,taskSelected:new Set(),taskMore:null},
    el: id => {
      assert.strictEqual(id, 'tasks');
      return tasks;
    },
    publicTaskState: pure.publicTaskState,
    taskGroupOpen: pure.taskGroupOpen,
    visibleTaskJobs: () => jobs,
    renderTaskFilters() {},
    taskRow: job => `<div class="task" data-row-state="${pure.publicTaskState(job)}" data-id="${job.job_id}"></div>`,
    esc: value => String(value == null ? '' : value),
    escA: value => String(value == null ? '' : value),
  };
  vm.runInNewContext(taskSource, sandbox);
  const countRows = state => (tasks.innerHTML.match(new RegExp(`data-row-state="${state}"`, 'g')) || []).length;
  const hasWholeHeader = state => new RegExp(`class="tgrp"[^>]*data-task-group="${state}"[^>]*aria-expanded="(?:true|false)"`).test(tasks.innerHTML);
  const clickGroup = state => {
    assert.ok(tasks.handlers.click, '任务列表没有 click 事件委托');
    const group = {dataset:{taskGroup:state}};
    tasks.handlers.click({
      target:{closest: selector => String(selector).includes('data-task-group') ? group : null},
      preventDefault(){}, stopPropagation(){}
    });
  };
  const failures = [];
  const expect = (ok, message) => { if(!ok) failures.push(message); };

  sandbox.renderTasks();
  expect(countRows('failed') === 0, `9 个未完成任务应默认折叠，实际渲染 ${countRows('failed')} 行`);
  expect(countRows('completed') === 0, `5 个已完成任务应默认完全折叠，实际渲染 ${countRows('completed')} 行`);
  expect(countRows('generating') === 1, '生成中任务应默认可见');
  expect(hasWholeHeader('failed'), '未完成整条标题缺少 data-task-group/aria-expanded 切换语义');
  expect(hasWholeHeader('completed'), '已完成整条标题缺少 data-task-group/aria-expanded 切换语义');
  for(const raw of ['unknown','stopped','paused','running','done'])
    expect(!hasWholeHeader(raw), `不得暴露内部状态分组 ${raw}`);

  clickGroup('failed');
  expect(countRows('failed') === 9, `点击未完成标题后应展开 9 行，实际 ${countRows('failed')} 行`);
  sandbox.renderTasks();
  expect(countRows('failed') === 9, '轮询式 renderTasks 重渲染后不应丢失未完成组的展开状态');
  clickGroup('failed');
  expect(countRows('failed') === 0, `再次点击未完成标题后应完全折叠，实际 ${countRows('failed')} 行`);

  clickGroup('completed');
  expect(countRows('completed') === 5, `点击已完成标题后应展开 5 行，实际 ${countRows('completed')} 行`);
  sandbox.renderTasks();
  expect(countRows('completed') === 5, '轮询式 renderTasks 重渲染后不应丢失已完成组的展开状态');
  clickGroup('completed');
  expect(countRows('completed') === 0, `再次点击已完成标题后应完全折叠，实际 ${countRows('completed')} 行`);

  assert.strictEqual(failures.length, 0, failures.join('；'));
});

test('运行日志按 skill_state 三态给出准确且可行动的提示', () => {
  const openLogSource = section('async function openLog()', 'async function rerunJob(');
  const assignmentStart = openLogSource.indexOf("el('logSkill').innerHTML =");
  const assignmentEnd = openLogSource.indexOf('\n  }catch', assignmentStart);
  assert.ok(assignmentStart >= 0 && assignmentEnd > assignmentStart, '无法提取运行日志的技能状态渲染片段');
  const renderStatement = openLogSource.slice(assignmentStart, assignmentEnd);
  const renderSkillState = r => {
    const node = {innerHTML: ''};
    vm.runInNewContext(renderStatement, {
      r,
      el(id) {
        assert.strictEqual(id, 'logSkill');
        return node;
      },
      esc(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    });
    return node.innerHTML;
  };

  const verified = renderSkillState({
    skill_state: 'verified', skill_used: true,
    hits: ['SKILL.md', 'quality_gate.py'], why: '检测到可核验运行轨迹'
  });
  const unverifiable = renderSkillState({
    skill_state: 'unverifiable', skill_used: false,
    hits: [], why: '本轮缺少可核验运行轨迹'
  });
  const missing = renderSkillState({
    skill_state: 'missing', skill_used: false,
    hits: [], why: '技能包未注入当前任务'
  });
  const failures = [];
  const expect = (ok, message) => { if(!ok) failures.push(message); };

  expect(/skill_state/.test(renderStatement), '渲染逻辑必须以 skill_state 区分三态，不能只依赖旧的 skill_used 布尔值');
  expect(/var\(--green\)/.test(verified), 'verified 状态应显示绿色');
  expect(/SKILL\.md/.test(verified), 'verified 状态应展示命中的技能证据');
  expect(!/var\(--amber\)|var\(--red\)/.test(verified), 'verified 状态不应混入琥珀色或红色告警');

  expect(/var\(--amber\)/.test(unverifiable), 'unverifiable 状态应显示琥珀色');
  expect(/不等于未使用/.test(unverifiable), 'unverifiable 文案必须明确说明“不等于未使用”');
  expect(!/var\(--red\)|✗/.test(unverifiable), 'unverifiable 状态不得显示红色或红叉');
  expect(!/没有检测到技能包被使用/.test(unverifiable), 'unverifiable 状态不得误报为没有使用技能包');
  expect(!/换成内置|切换内置引擎|SoWork\s*\/\s*Claude Code\s*\/\s*Codex/.test(unverifiable),
    'unverifiable 状态不得建议切换内置引擎');

  expect(/var\(--red\)/.test(missing), 'missing 状态才应显示红色');
  expect(/✗/.test(missing), 'missing 状态应显示明确的失败标记');
  expect(/检查.{0,40}(技能包|路径|注入|\{skill\})/.test(missing),
    'missing 状态应给出检查技能包路径或注入状态的针对性动作');
  expect(verified !== unverifiable && unverifiable !== missing && verified !== missing,
    'verified、unverifiable、missing 三态输出必须彼此不同');

  assert.strictEqual(failures.length, 0, failures.join('；'));
});

function taskBulkRuntime(options) {
  const opts = options || {};
  const taskSource = section('function taskRow(j, compact)', '/* ================= 选择任务 + SSE');
  const tasks = {
    innerHTML: '',
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; }
  };
  const selectedByNormalClick = [];
  const sandbox = {
    S: {
      online: opts.online !== false,
      jobs: opts.jobs || [], active: null, prog: {}, arts: {}, artsLoaded: {}, health: {}, es: null,
      archivedJobs:[],taskScope:'active',projectFilter:'',
      taskGrpOpen: {preparing:true, generating:true, needs_input:true, completed:true, failed:true},
      taskBulkMode: false, taskBulkDeleting: false, taskBulkBusy:false, taskBulkMore:false, taskSelected: new Set(),taskMore:null,
    },
    FORCE_DEMO: !!opts.forceDemo,
    el(id) {
      assert.strictEqual(id, 'tasks');
      return tasks;
    },
    completionGate: pure.completionGate,
    wordPresence: pure.wordPresence,
    publicTaskState: pure.publicTaskState,
    taskPresentation: pure.taskPresentation,
    taskCapabilities: pure.taskCapabilities,
    taskGroupOpen: pure.taskGroupOpen,
    visibleTaskJobs: () => sandbox.S.jobs.filter(j=>!j.archived_at),
    renderTaskFilters() {},
    verdict: () => ({color: 'var(--green)'}),
    esc: value => String(value == null ? '' : value),
    escA: value => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    select(id) { selectedByNormalClick.push(id); },
    askConfirm: opts.askConfirm || (async () => true),
    api: opts.api || (async path => path === '/v1/jobs' ? [] : {}),
    renderMain() {},
    renderRail() {},
    toast: opts.toast || (() => {}),
  };
  vm.runInNewContext(`${taskSource}\nthis.__taskBulk = {
    renderTasks,
    setTaskBulkMode: typeof setTaskBulkMode === 'function' ? setTaskBulkMode : null,
    toggleTaskSelection: typeof toggleTaskSelection === 'function' ? toggleTaskSelection : null,
    toggleAllTaskSelection: typeof toggleAllTaskSelection === 'function' ? toggleAllTaskSelection : null,
    deleteSelectedJobs: typeof deleteSelectedJobs === 'function' ? deleteSelectedJobs : null
  };`, sandbox);
  return {tasks, sandbox, selectedByNormalClick, api: sandbox.__taskBulk};
}

function checkboxTags(markup) {
  return (String(markup).match(/<input\b[^>]*>/gi) || [])
    .filter(tag => /\btype=["']checkbox["']/i.test(tag));
}

test('任务侧栏批量模式可进入退出、逐项选择并全选或取消全选', () => {
  const jobs = [
    {job_id: 'job-a', name: '任务甲', state: 'running'},
    {job_id: 'job-b', name: '任务乙', state: 'running'},
    {job_id: 'job-c', name: '任务丙', state: 'done'},
  ];
  const runtime = taskBulkRuntime({jobs});
  const bulk = runtime.api;

  assert.strictEqual(typeof bulk.setTaskBulkMode, 'function', '缺少进入/退出任务批量管理的可执行函数 setTaskBulkMode');
  assert.strictEqual(typeof bulk.toggleTaskSelection, 'function', '缺少逐项勾选函数 toggleTaskSelection');
  assert.strictEqual(typeof bulk.toggleAllTaskSelection, 'function', '缺少全选/取消全选函数 toggleAllTaskSelection');

  bulk.renderTasks();
  assert.match(runtime.tasks.innerHTML, /批量管理/, '普通任务侧栏缺少批量管理入口');
  assert.strictEqual(checkboxTags(runtime.tasks.innerHTML).length, 0, '普通模式不应显示任务复选框');

  const row = {dataset: {id: 'job-b'}};
  assert.ok(runtime.tasks.handlers.click, '任务列表缺少原有的点击事件委托');
  runtime.tasks.handlers.click({
    target: {closest: selector => String(selector).includes('data-id') ? row : null},
    stopPropagation() {}, preventDefault() {},
  });
  assert.deepStrictEqual(runtime.selectedByNormalClick, ['job-b'], '普通模式单击任务仍应打开该任务');

  bulk.setTaskBulkMode(true);
  bulk.renderTasks();
  assert.strictEqual(checkboxTags(runtime.tasks.innerHTML).length, jobs.length, '批量模式下每条当前任务都必须显示复选框');
  assert.ok((runtime.tasks.innerHTML.match(/class="tbrow/g) || []).length >= 3, '批量工具栏必须分行，避免窄侧栏溢出');
  assert.match(runtime.tasks.innerHTML, /退出批量|完成管理|取消批量/, '批量模式缺少明确的退出入口');
  assert.match(runtime.tasks.innerHTML, /全选/, '批量模式缺少全选当前任务列表入口');

  bulk.toggleTaskSelection('job-b', true);
  bulk.renderTasks();
  const oneSelected = checkboxTags(runtime.tasks.innerHTML);
  assert.ok(oneSelected.find(tag => /job-b/.test(tag) && /\bchecked\b/i.test(tag)), '逐项勾选没有更新对应任务');
  assert.strictEqual(oneSelected.filter(tag => /\bchecked\b/i.test(tag)).length, 1, '逐项勾选不应误选其他任务');

  bulk.toggleAllTaskSelection();
  bulk.renderTasks();
  assert.strictEqual(
    checkboxTags(runtime.tasks.innerHTML).filter(tag => /\bchecked\b/i.test(tag)).length,
    jobs.length,
    '全选应覆盖当前任务列表中的全部任务'
  );
  assert.match(runtime.tasks.innerHTML, /取消全选/, '全选完成后入口应切换为取消全选');

  bulk.toggleAllTaskSelection();
  bulk.renderTasks();
  assert.strictEqual(
    checkboxTags(runtime.tasks.innerHTML).filter(tag => /\bchecked\b/i.test(tag)).length,
    0,
    '再次操作应取消全选'
  );

  bulk.setTaskBulkMode(false);
  bulk.renderTasks();
  assert.strictEqual(checkboxTags(runtime.tasks.innerHTML).length, 0, '退出批量管理后必须隐藏所有复选框');
});

asyncTest('批量删除只删勾选 ID，一次确认且单项失败不阻断其余任务', async () => {
  const failedId = '失败/任务 一';
  const successId = '成功/任务 二';
  const untouchedId = '未选择/任务 三';
  const jobs = [
    {job_id: failedId, name: '会失败', state: 'running'},
    {job_id: successId, name: '会成功', state: 'running'},
    {job_id: untouchedId, name: '不应删除', state: 'running'},
  ];
  const confirmations = [];
  const deletePaths = [];
  const summaries = [];
  let refreshes = 0;
  const refreshedJobs = [jobs[0], jobs[2]];
  const runtime = taskBulkRuntime({
    jobs,
    askConfirm: async (...args) => { confirmations.push(args); return true; },
    api: async (requestPath, options) => {
      if(options && options.method === 'DELETE') {
        deletePaths.push(requestPath);
        if(requestPath === '/v1/jobs/' + encodeURIComponent(failedId)) throw new Error('synthetic delete failure');
        return {ok: true};
      }
      if(requestPath === '/v1/jobs') { refreshes += 1; return refreshedJobs; }
      throw new Error('unexpected request: ' + requestPath);
    },
    toast: text => summaries.push(String(text)),
  });
  const bulk = runtime.api;

  assert.strictEqual(typeof bulk.deleteSelectedJobs, 'function', '缺少可执行的批量删除函数 deleteSelectedJobs');
  assert.strictEqual(typeof bulk.setTaskBulkMode, 'function', '批量删除必须由批量管理模式承载');
  assert.strictEqual(typeof bulk.toggleTaskSelection, 'function', '批量删除必须以逐项勾选结果为准');

  bulk.setTaskBulkMode(true);
  bulk.toggleTaskSelection(failedId, true);
  bulk.toggleTaskSelection(successId, true);
  await bulk.deleteSelectedJobs();

  assert.strictEqual(confirmations.length, 1, '整批删除必须且只能确认一次，不能逐条弹确认框');
  assert.match(String(confirmations[0][0] || ''), /2/, '确认内容应明确本次会删除 2 条任务');
  assert.deepStrictEqual(
    deletePaths.slice().sort(),
    [
      '/v1/jobs/' + encodeURIComponent(failedId),
      '/v1/jobs/' + encodeURIComponent(successId),
    ].sort(),
    '只能请求删除已勾选 ID，且每个 ID 必须经过 encodeURIComponent'
  );
  assert.ok(!deletePaths.includes('/v1/jobs/' + encodeURIComponent(untouchedId)), '未勾选任务不得进入删除请求');
  assert.strictEqual(deletePaths.length, 2, '一个删除失败后仍必须继续尝试其余已勾选任务');
  assert.strictEqual(refreshes, 1, '整批处理完成后应只刷新一次任务列表');
  assert.deepStrictEqual(runtime.sandbox.S.jobs, refreshedJobs, '刷新结果必须回填当前任务列表');
  assert.strictEqual(runtime.sandbox.S.taskSelected.size, 0, '批量处理结束后必须清空选择');
  assert.ok(
    summaries.some(text => /成功\s*1[^\d]+失败\s*1/.test(text)),
    '部分失败时应给出包含成功数和失败数的汇总提示'
  );
});

asyncTest('列表刷新失败不污染删除失败数，并按成功结果先更新本地列表', async () => {
  const jobs = [
    {job_id: 'delete-a', name: '删除甲', state: 'done'},
    {job_id: 'delete-b', name: '删除乙', state: 'done'},
    {job_id: 'keep-c', name: '保留丙', state: 'done'},
  ];
  const summaries = [];
  let refreshes = 0;
  const runtime = taskBulkRuntime({
    jobs,
    api: async (requestPath, options) => {
      if(options && options.method === 'DELETE') return {ok:true};
      if(requestPath === '/v1/jobs') { refreshes += 1; throw new Error('synthetic refresh failure'); }
      throw new Error('unexpected request: ' + requestPath);
    },
    toast: text => summaries.push(String(text)),
  });
  const bulk = runtime.api;
  bulk.setTaskBulkMode(true);
  bulk.toggleTaskSelection('delete-a', true);
  bulk.toggleTaskSelection('delete-b', true);
  await bulk.deleteSelectedJobs();

  assert.strictEqual(refreshes, 1, '刷新失败时也只能尝试刷新一次');
  assert.deepStrictEqual(runtime.sandbox.S.jobs.map(j => j.job_id), ['keep-c'], '刷新失败时应从本地列表移除已成功删除项');
  assert.ok(summaries.some(text => /成功\s*2[^\d]+失败\s*0/.test(text)), '刷新失败不得被计成第三个删除失败');
  assert.ok(summaries.some(text => /列表刷新失败/.test(text)), '应单独提示列表刷新失败');
  assert.strictEqual(runtime.sandbox.S.taskBulkMode, false, '全部 DELETE 成功后即使刷新失败也应退出批量模式');
});

asyncTest('演示或断线模式只在本地删除任务，不请求不存在的后端', async () => {
  for(const mode of [{forceDemo:true}, {online:false}]) {
    const jobs = [
      {job_id: 'demo-a', name: '演示甲', state: 'running'},
      {job_id: 'demo-b', name: '演示乙', state: 'done'},
      {job_id: 'demo-c', name: '演示丙', state: 'done'},
    ];
    let apiCalls = 0;
    const summaries = [];
    const runtime = taskBulkRuntime({
      jobs,
      ...mode,
      api: async () => { apiCalls += 1; throw new Error('local delete must not call API'); },
      toast: text => summaries.push(String(text)),
    });
    const bulk = runtime.api;
    bulk.setTaskBulkMode(true);
    bulk.toggleTaskSelection('demo-a', true);
    bulk.toggleTaskSelection('demo-b', true);
    await bulk.deleteSelectedJobs();

    assert.strictEqual(apiCalls, 0, '演示/断线本地删除不得发送 DELETE 或刷新请求');
    assert.deepStrictEqual(runtime.sandbox.S.jobs.map(j => j.job_id), ['demo-c']);
    assert.ok(summaries.some(text => /成功\s*2[^\d]+失败\s*0/.test(text)), '本地删除应按所选任务数准确汇总');
  }
});

asyncTest('DELETE 虽返回成功但刷新后任务仍在时不得假报已删除', async () => {
  const jobs = [
    {job_id: 'stuck-job', name: '目录仍在', state: 'running'},
    {job_id: 'keep-job', name: '保留任务', state: 'done'},
  ];
  const summaries = [];
  let streamCloses = 0;
  const runtime = taskBulkRuntime({
    jobs,
    api: async (requestPath, options) => {
      if(options && options.method === 'DELETE') return {ok:true};
      if(requestPath === '/v1/jobs') return jobs;
      throw new Error('unexpected request: ' + requestPath);
    },
    toast: text => summaries.push(String(text)),
  });
  runtime.sandbox.S.active = 'stuck-job';
  runtime.sandbox.S.es = {close(){ streamCloses += 1; }};
  const bulk = runtime.api;
  bulk.setTaskBulkMode(true);
  bulk.toggleTaskSelection('stuck-job', true);
  await bulk.deleteSelectedJobs();

  assert.ok(summaries.some(text => /成功\s*0[^\d]+失败\s*1/.test(text)), '刷新证明确实未删除时必须改报失败');
  assert.strictEqual(runtime.sandbox.S.active, 'stuck-job', '未真正删除的活动任务不能被清空');
  assert.strictEqual(streamCloses, 0, '未真正删除的活动任务不能关闭事件流');
  assert.strictEqual(runtime.sandbox.S.taskBulkMode, true, '存在删除失败时应留在批量模式');
});

asyncTest('批量删除处理中防止重复确认和重复请求', async () => {
  const jobs = [{job_id: 'once-only', name: '只删一次', state: 'done'}];
  let resolveConfirm;
  let confirmations = 0;
  let deletes = 0;
  let refreshes = 0;
  const runtime = taskBulkRuntime({
    jobs,
    askConfirm: () => {
      confirmations += 1;
      return new Promise(resolve => { resolveConfirm = resolve; });
    },
    api: async (requestPath, options) => {
      if(options && options.method === 'DELETE') { deletes += 1; return {ok:true}; }
      if(requestPath === '/v1/jobs') { refreshes += 1; return []; }
      throw new Error('unexpected request: ' + requestPath);
    },
  });
  const bulk = runtime.api;
  bulk.setTaskBulkMode(true);
  bulk.toggleTaskSelection('once-only', true);
  const first = bulk.deleteSelectedJobs();
  const second = bulk.deleteSelectedJobs();

  assert.strictEqual(confirmations, 1, '处理中再次触发不得覆盖确认框或重复确认');
  assert.strictEqual(runtime.sandbox.S.taskBulkDeleting, true, '确认与删除期间应保持 deleting 状态');
  assert.match(runtime.tasks.innerHTML, /处理中/);
  resolveConfirm(true);
  await Promise.all([first, second]);

  assert.strictEqual(deletes, 1, '重复触发不得重复 DELETE 同一任务');
  assert.strictEqual(refreshes, 1, '重复触发不得造成第二次列表刷新');
  assert.strictEqual(runtime.sandbox.S.taskBulkDeleting, false, '操作结束后必须解除 deleting 状态');
});

(async () => {
  for(const item of pendingTests) {
    try {
      await item.fn();
      passed += 1;
      process.stdout.write(`✓ ${item.name}\n`);
    } catch(error) {
      failed += 1;
      process.stderr.write(`✗ ${item.name}\n  ${error.message}\n`);
    }
  }
  process.stdout.write(`\nfrontend stability: ${passed} passed, ${failed} failed\n`);
  if(failed) process.exitCode = 1;
})();
