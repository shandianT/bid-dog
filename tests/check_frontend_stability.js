#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'app', 'src', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

let passed = 0;
let failed = 0;
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

process.stdout.write(`\nfrontend stability: ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
