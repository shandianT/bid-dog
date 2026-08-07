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
  vm.runInNewContext(`${block}\nthis.__pure = { isBodyWordArtifact, wordPresence, completionGate, activeClock, eventStreamUrl, withDiagnosticAction, healthUpdateInfo, modeFromModel, modeSwitchBlocked };`, sandbox);
  pure = sandbox.__pure;
}

test('稳定性纯函数块存在并可由 Node 直接执行', () => {
  assert.ok(pure, '缺少 FRONTEND_STABILITY_PURE 标记或函数');
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
  assert.strictEqual(pure.healthUpdateInfo({update: {status: 'latest', latest: '0.18.2'}}), null);
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
  expectHtml(/QK_SWITCH_SEQ/);
  assert.ok(/modeFromModel\(eff\)/.test(loadAgent) && /setQkMode\(actualMode\)/.test(loadAgent), '实际模型没有回填到模式按钮');
  assert.ok(/QK_SWITCH_QUEUE/.test(switcher) && /\/v1\/agent\/test/.test(switcher), '模式切换没有串行并真实探活');
  assert.ok(/Promise\.all\(\[api\('\/v1\/agent'\), api\('\/v1\/jobs'\)\]\)/.test(switcher), '切换前没有刷新实际任务状态');
  assert.ok(/oldPayload/.test(switcher) && /已恢复原模式/.test(switcher), '模式切换失败没有回滚');
  assert.ok(/setQkMode\(previousMode\)[\s\S]*await loadAgent\(\)/.test(switcher), '失败后没有以服务端真实状态最终回填');
  expectHtml(/模式未切换/);
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
  assert.ok(/BUNDLED_ENGINE_VERSION\s*=\s*'0\.18\.2'/.test(connection), '桌面端没有钉住当前引擎版本');
  assert.ok(/DESKTOP_ENGINE\s*=\s*'http:\/\/127\.0\.0\.1:18802'/.test(connection), '桌面端没有使用版本专属端口');
  assert.ok(/IS_WEB\s*\?\s*\[location\.origin\]\s*:\s*\[DESKTOP_ENGINE\]/.test(connection), '桌面端仍会探测历史端口');
  assert.ok(!/8849|8848|8080/.test(connection), '连接候选仍含历史引擎端口');
  assert.ok(/h\.version\s*===\s*BUNDLED_ENGINE_VERSION/.test(html), '健康检查没有拒绝错误版本');
  assert.ok(/const ENGINE_PORT:\s*u16\s*=\s*18802;/.test(rustMain), 'Tauri 启动端口与前端不一致');
});

test('覆盖安装时 WebView 不复用旧前端缓存或历史引擎地址', () => {
  const mainWindow = (((tauriConf || {}).app || {}).windows || [])[0] || {};
  const launchUrl = String(mainWindow.url || '');
  const failures = [];
  if(mainWindow.incognito !== true) failures.push('主窗口必须启用 incognito=true 隔离旧 WebView 缓存');
  if(!/0\.18\.2/.test(launchUrl) || !/18802/.test(launchUrl))
    failures.push('主窗口 URL 必须同时包含版本 0.18.2 与专属端口 18802 作为缓存版本戳');
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

test('状态不明与已完成任务组默认真折叠，整条标题切换且轮询重渲染不丢状态', () => {
  const taskSource = section('function renderTasks()', 'async function delJob');
  const tasks = {
    innerHTML: '',
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; }
  };
  const jobs = [];
  for(let i=0;i<9;i++) jobs.push({job_id:`unknown-${i}`, name:`unknown ${i}`, state:'unknown'});
  for(let i=0;i<5;i++) jobs.push({job_id:`done-${i}`, name:`done ${i}`, state:'done'});
  const sandbox = {
    S: {jobs, active:'done-0', prog:{}, taskGrpOpen:{}},
    el: id => {
      assert.strictEqual(id, 'tasks');
      return tasks;
    },
    jobState: job => job.state,
    taskRow: job => `<div class="task" data-row-state="${job.state}" data-id="${job.job_id}"></div>`,
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
  expect(countRows('unknown') === 0, `9 个状态不明任务应默认折叠，实际渲染 ${countRows('unknown')} 行`);
  expect(countRows('done') === 0, `5 个已完成任务应默认完全折叠（包括 active 行），实际渲染 ${countRows('done')} 行`);
  expect(hasWholeHeader('unknown'), '状态不明整条标题缺少 data-task-group/aria-expanded 切换语义');
  expect(hasWholeHeader('done'), '已完成整条标题缺少 data-task-group/aria-expanded 切换语义');

  clickGroup('unknown');
  expect(countRows('unknown') === 9, `点击状态不明标题后应展开 9 行，实际 ${countRows('unknown')} 行`);
  sandbox.renderTasks();
  expect(countRows('unknown') === 9, '轮询式 renderTasks 重渲染后不应丢失状态不明组的展开状态');
  clickGroup('unknown');
  expect(countRows('unknown') === 0, `再次点击状态不明标题后应完全折叠，实际 ${countRows('unknown')} 行`);

  clickGroup('done');
  expect(countRows('done') === 5, `点击已完成标题后应展开 5 行，实际 ${countRows('done')} 行`);
  sandbox.renderTasks();
  expect(countRows('done') === 5, '轮询式 renderTasks 重渲染后不应丢失已完成组的展开状态');
  clickGroup('done');
  expect(countRows('done') === 0, `再次点击已完成标题后应完全折叠且不保留 active 行，实际 ${countRows('done')} 行`);

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
      taskGrpOpen: {staged:true, running:true, paused:true, stopped:true, unknown:true, done:true},
      taskBulkMode: false, taskBulkDeleting: false, taskSelected: new Set(),
    },
    FORCE_DEMO: !!opts.forceDemo,
    el(id) {
      assert.strictEqual(id, 'tasks');
      return tasks;
    },
    completionGate: pure.completionGate,
    wordPresence: pure.wordPresence,
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
  assert.strictEqual((runtime.tasks.innerHTML.match(/class="tbrow/g) || []).length, 2, '批量工具栏必须分成两行，避免窄侧栏溢出');
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
  assert.match(runtime.tasks.innerHTML, /data-task-bulk-delete="1"[^>]*disabled/);
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
