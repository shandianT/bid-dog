#!/usr/bin/env node
// 把经典单文件前端(app/src/index.html, 基准=main+PR#10)里的框架无关代码
// 机械抽取成 ES 模块。逐字保真:除了下面这张替换表,不改一个字。
// 替换表只做一件事:把「直接操作 DOM/直接重绘」换成 ui 适配器调用,语义由 React 侧承接。
// 重跑方式:node tools/extract-core.mjs tools/baseline-index.html
import fs from 'node:fs';
import path from 'node:path';

const srcPath = process.argv[2] || 'tools/baseline-index.html';
const src = fs.readFileSync(srcPath, 'utf8');
const outDir = path.join(path.dirname(srcPath), '..', 'src', 'core', 'gen');
fs.mkdirSync(outDir, { recursive: true });

function between(startPat, endPat){
  const a = src.indexOf(startPat);
  if(a < 0) throw new Error('起点没找到: ' + startPat);
  const b = src.indexOf(endPat, a + startPat.length);
  if(b < 0) throw new Error('终点没找到: ' + endPat);
  return src.slice(a, b);
}

// DOM 触点 → ui 适配器。每一行都要能对着经典源码讲清楚等价性。
function transform(code){
  return code
    .replace(/renderTasks\(\)/g, "ui.render('tasks')")
    .replace(/renderHead\(\)/g, "ui.render('head')")
    .replace(/renderRail\(\)/g, "ui.render('rail')")
    .replace(/renderMain\(\)/g, "ui.render('main')")
    .replace(/renderChat\(\)/g, "ui.render('chat')")
    .replace(/renderWorklog\(\)/g, "ui.render('worklog')")
    .replace(/renderFlowConsole\(\)/g, "ui.render('flow')")
    .replace(/renderProblem\(\)/g, "ui.render('problem')")
    .replace(/renderAtts\(\)/g, "ui.render('atts')")
    .replace(/renderP0Views\(\)/g, "ui.render('p0')")
    .replace(/renderCovPill\(\)/g, "ui.render('covpill')")
    .replace(/el\('conn'\)\.textContent\s*=\s*([^;]+);/g, 'ui.conn($1);')
    .replace(/\banswerMode\(/g, 'ui.answerMode(')
    .replace(/\bnotify\(/g, 'ui.notify(')
    .replace(/\btoast\(/g, 'ui.toast(')
    .replace(/renderTaskFilters\(\)/g, "ui.render('taskFilters')")
    .replace(/\baskConfirm\(/g, 'ui.askConfirm(')
    .replace(/\bopenProjectMove\(/g, 'ui.openProjectMove(')
    .replace(/\bcloseAll\(\)/g, 'ui.closeAll()')
    .replace(/\bshowDiagnosticDetail\(/g, 'ui.showDiagnosticDetail(')
    .replace(/\brunDiagnostics\(\)/g, 'ui.runDiagnostics()')
    .replace(/\bautoUpdate\(\)/g, 'ui.openUpdatePanel()')
    .replace(/\bopenRevision\(\)/g, 'ui.openRevision()')
    .replace(/\bdownloadDiagnosticBundle\(\)/g, 'ui.downloadDiagnosticBundle()')
    .replace(/\bopenSheet\(/g, 'ui.openSheet(')
    .replace(/\bopenLog\(\)/g, 'ui.openLog()')
    .replace(/\bopenRedo\(\)/g, 'ui.openRedo()')
    .replace(/\bopenCheck\(\)/g, 'ui.openCheck()')
    .replace(/\brepairJob\(\)/g, 'ui.repairJob()')
    .replace(/\bopenArtifact\(/g, 'ui.openArtifact(')
    .replace(/\bopenJobFolder\(\)/g, 'ui.openJobFolder()')
    .replace(/\(el\('problemHost'\)&&el\('problemHost'\)\._detail\)/g,
             "((S.problems[S.active||'_global']||S.problems._global||{}).detail)")
    .replace(/\bAPI\b/g, 'net.API');
}

const header = f => `// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。\n// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。\n`;

// ---------- pure.js:稳定性纯逻辑块,零依赖,原文照搬 ----------
{
  const block = between('/* FRONTEND_STABILITY_PURE_START */', '/* FRONTEND_STABILITY_PURE_END */')
    + '/* FRONTEND_STABILITY_PURE_END */';
  const names = [...block.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Z_][\w$]*)\s*=)/gm)]
    .map(m => m[1] || m[2]);
  fs.writeFileSync(path.join(outDir, 'pure.js'),
    header('pure') + block + '\nexport {\n  ' + names.join(', ') + '\n};\n');
  console.log('pure.js:', names.length, '个导出');
}

// ---------- api.js:请求层(超时/请求号/业务错误码/版本停服) ----------
{
  const body = between('async function api(p, opt){', 'function el(id){');
  fs.writeFileSync(path.join(outDir, 'api.js'), header('api')
    + "import { net } from '../env.js';\nimport { presentProblem } from '../problems.js';\n\n"
    + 'export ' + transform(body).trimEnd() + '\n');
}

// ---------- jobs.js:选择任务/SSE 重连/事件归约 handle/计时/任务态 ----------
{
  const pipeline = between('async function loadPipeline(id){', 'function renderCovPill(){');
  const covHint = between('function covReasonHint(item){', 'function openCoverage(){');
  const sse = between('/* ================= 选择任务 + SSE(断线自动重连) ================= */',
                      "document.addEventListener('visibilitychange'");
  const visibility = between("document.addEventListener('visibilitychange'", 'function attachES(id, reconnecting){');
  const rest = between('function attachES(id, reconnecting){', '/* ================= 头部 / 对话 / 快捷 ================= */');
  const jobState = between('function jobState(j){', 'function setTaskBulkMode(');
  const verdict = between('function verdict(id){', 'function renderHead(){');
  const out = header('jobs')
    + "import { net, IS_WEB } from '../env.js';\n"
    + "import { S, ui } from '../store.js';\n"
    + "import { api } from './api.js';\n"
    + "import { presentProblem } from '../problems.js';\n"
    + "import { _friendlyText, friendlyRuntimeNotice, withDiagnosticAction, isBodyWordArtifact,\n"
    + "         wordPresence, nextStreamState, streamReconnectDelay, eventStreamUrl, activeClock } from './pure.js';\n\n"
    + transform(pipeline) + transform(covHint)
    + transform(sse)
    + 'export function installVisibilityHandler(){\n  ' + transform(visibility).trimEnd().replace(/\n/g, '\n  ') + '\n}\n\n'
    + transform(rest)
    + transform(jobState) + transform(verdict)
    + '\nexport { loadPipeline, loadCoverage, maybeRefreshP0, covReasonHint,\n'
    + '  stopJobPolling, loadJobs, pollJobState, startJobPolling, clearStreamRecovery,\n'
    + '  resetStreamReplayState, markStreamOpen, recordStreamFailure, select, attachES,\n'
    + '  eventIsRecent, handle, refreshArts, loadAtts, DEFAULT_STAGES, ts2ms, fmtDur, timing,\n'
    + '  jobState, verdict };\n';
  fs.writeFileSync(path.join(outDir, 'jobs.js'), out);
}

// ---------- tasks.js:任务列表数据层与批量/归档/导出/删除动作 ----------
{
  const listing = between('/* ================= 任务列表(事件委托,名字含引号也安全) ================= */',
                          'function renderTaskFilters(){');
  const scope = between('async function setTaskScope(scope){', "el('taskScope').addEventListener");
  const bulk = between('function setTaskBulkMode(enabled){', 'function renderTasks(){');
  const rowActs = between('async function archiveJob(id){', 'function openProjectMove(ids){');
  const bulkActs = between('async function runBulkTaskAction(action){', 'async function delJob(id){');
  const del = between('async function delJob(id){', '/* ================= 选择任务 + SSE(断线自动重连) ================= */');
  fs.writeFileSync(path.join(outDir, 'tasks.js'), header('tasks')
    + "import { net, FORCE_DEMO } from '../env.js';\n"
    + "import { S, ui } from '../store.js';\n"
    + "import { api } from './api.js';\n"
    + "import { presentProblem } from '../problems.js';\n"
    + "import { clearStreamRecovery } from './jobs.js';\n"
    + "import { rerunJob } from './actions.js';\n\n"
    + transform(listing) + transform(scope) + transform(bulk) + transform(rowActs)
    + transform(bulkActs) + transform(del)
    + '\nexport { taskSourceJobs, archivedOnly, visibleTaskJobs, setTaskScope, setTaskProjectFilter,\n'
    + '  setTaskBulkMode, toggleTaskSelection, toggleAllTaskSelection, archiveJob, restoreJob,\n'
    + '  exportJobs, runBulkTaskAction, runTaskRowAction, delJob, deleteSelectedJobs };\n');
}

// ---------- actions.js:任务控制/消息动作(继续、暂停、停止、重跑、回答、errAction) ----------
{
  const control = between('async function resumeJob(){', 'function openRevision(){');
  const rerun = between('async function rerunJob(skipAsk){', 'function renderWorklog(){');
  const err = between('async function errAction(act, file, param){', '/* ================= 右栏卡片 ================= */');
  const sayFn = between('async function say(text){', '/* 点了「我来输入」不是把「我来输入」四个字当答案发出去');
  const answerFn = between('async function answer(choice){', 'function notify(t){');
  fs.writeFileSync(path.join(outDir, 'actions.js'), header('actions')
    + "import { ASK_SELF } from '../env.js';\n"
    + "import { S, ui } from '../store.js';\n"
    + "import { api } from './api.js';\n"
    + "import { presentProblem } from '../problems.js';\n"
    + "import { taskCapabilities, _friendlyText } from './pure.js';\n"
    + "import { select, loadJobs, refreshArts } from './jobs.js';\n"
    + "import { openUpdate } from '../update.js';\n\n"
    + transform(control) + transform(rerun) + transform(err) + transform(sayFn) + transform(answerFn)
    + '\nexport { resumeJob, togglePause, stopJob, rerunJob, errAction, say, answer, addLocal };\n');
}

// ---------- demo.js:演示模式,与真实运行同一条 handle() 通道 ----------
{
  const body = between('/* ================= 演示模式 ================= */', '/* 运行中的任务每秒刷新耗时/预估 */');
  fs.writeFileSync(path.join(outDir, 'demo.js'), header('demo')
    + "import { S, ui } from '../store.js';\nimport { handle, select } from './jobs.js';\n\n"
    + transform(body).trimEnd()
    + '\nexport { demoBoot, demoNew, demoRun, DEMO_LOG };\n');
}

console.log('抽取完成 →', outDir);
