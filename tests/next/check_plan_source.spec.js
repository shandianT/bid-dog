// 【新界面专属】评分点覆盖的「来源」:本地关键词索引 ≠ 真实覆盖率。
//
// 默认流水线里响应规划先由本地索引兜底,再请模型逐项核对。本地索引的矩阵里没有一条
// 落到章节、缺口全是〔需补充〕——按老口径算就是 0/N,顶栏挂一个「评分点覆盖 0/12」,
// 用户以为标书一分没答。引擎现在透出 plan_source,界面按来源分两种说法:
//   local → 「评分点 N 项 · 待核对」,面板说明原因,不画覆盖条、不给补写按钮;
//   model → 照旧的真实覆盖率,规划备注(如分值合计对不上)在面板顶部提示。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const LOCAL_JOB = 'plansrc-local';
const MODEL_JOB = 'plansrc-model';

function node(id, kind, outputs, title, state) {
  return {
    id, kind, state, model_tier: kind === 'model' ? 'fast' : '', title,
    outputs, min_chars: 0, attempt: 1, attempt_serial: 1, max_attempts: 5,
    dependencies: [], input_digest: 'digest', started_at: '', finished_at: '',
    last_activity_at: '', error_code: '', retry_after_seconds: 0,
  };
}

function writeJob(home, id, name, ts, matrixRows, plan) {
  const job = path.join(home, 'jobs', id);
  fs.mkdirSync(job, { recursive: true });
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({
    name, tender: '招标文件.docx', created_at: ts,
  }, null, 2));
  fs.writeFileSync(path.join(job, '章节_01_技术方案.md'), '# 技术方案\n\n' + '正文段落。\n'.repeat(200));
  fs.writeFileSync(path.join(job, '评分点响应矩阵.md'), [
    '# 评分点响应矩阵', '',
    '| 序号 | 原要求/评分点 | 分值 | 响应位置 | 证据 | 缺口 |',
    '|---|---|---:|---|---|---|',
    ...matrixRows, '',
  ].join('\n'));
  fs.writeFileSync(path.join(job, 'response_plan.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(job, 'outcome.json'), JSON.stringify({
    state: 'stopped', reason: '固定夹具',
  }, null, 2));
  fs.writeFileSync(path.join(job, 'pipeline.json'), JSON.stringify({
    version: 2, run_id: 'run-' + id, mode: 'fast', state: 'running', recoverable: true,
    current_nodes: [], model_routes: { fast: 'test-model', quality: 'test-model' },
    nodes: [
      node('source_parse', 'local', ['招标文件_解析版.md'], '本地解析招标文件', 'done'),
      node('response_plan', 'model', ['评分点响应矩阵.md'], '提取响应规划', 'done'),
      node('chapter_write:c1', 'model', ['章节_01_技术方案.md'], '技术方案', 'done'),
      node('assemble', 'local', ['投标文件_整册.md'], '汇总整册', 'pending'),
    ],
    created_at: ts, updated_at: ts,
  }, null, 2));
}

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  // 比所有 fixture 都旧:不抢自动选中
  writeJob(home, LOCAL_JOB, '只有本地索引的任务', '2026-08-02 09:00:00', [
    '| 1 | 技术方案 20 分:实施方案完整性 | 20 分 | 评分证据与对应章节 | 招标文件_解析版.md | 〔需补充〕提交前核对分值、响应位置和证据 |',
    '| 2 | 售后服务 10 分:响应时间 | 10 分 | 评分证据与对应章节 | 招标文件_解析版.md | 〔需补充〕提交前核对分值、响应位置和证据 |',
  ], { chapters: [], source: 'local', model: '', notes: [] });
  writeJob(home, MODEL_JOB, '模型核对过的任务', '2026-08-02 09:00:01', [
    '| 1 | 实施方案完整性 | 60 分 | 技术方案 | 正文 | 无 |',
    '| 2 | 响应时间承诺 | 10 分 | 售后服务 | 承诺函 | 〔需补充〕承诺函 |',
  ], { chapters: [], source: 'model', model: 'test-model',
       notes: ['分值合计 70 分,与评分办法总分 100 分不一致,提交前请人工核对评分表'] });
});

async function openJob(page, id, name) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.waitForFunction(jid => (window.S.jobs || []).some(j => j.job_id === jid), id, { timeout: 15_000 });
  await page.evaluate(jid => window.select(jid), id);
  await expect(page.locator('#hTitle')).toHaveText(name);
}

test('a local-index plan is presented as candidates awaiting model check, never as 0/N', async ({ page }) => {
  await openJob(page, LOCAL_JOB, '只有本地索引的任务');
  const pill = page.locator('#covPill');
  await expect(pill).toContainText('待核对');
  await expect(pill).toContainText('2');
  await expect(pill).not.toContainText('0/');
  await expect(page.locator('#rail')).toContainText('评分点 · 待核对');
  await pill.click();
  await expect(page.locator('#covSheet')).toBeVisible();
  await expect(page.locator('#covSheet .covlocal')).toBeVisible();
  await expect(page.locator('#covHead')).toContainText('候选');
  await expect(page.locator('#covBarFill')).toHaveCount(0);
  await expect(page.locator('[data-covbatch]')).toHaveCount(0);
  await expect(page.locator('#covList .covitem').first()).toContainText('候选项');
});

test('a model-checked plan keeps the real coverage and surfaces plan notes', async ({ page }) => {
  await openJob(page, MODEL_JOB, '模型核对过的任务');
  await expect(page.locator('#covPill')).toContainText('1/2');
  await page.locator('#covPill').click();
  await expect(page.locator('#covSheet .covlocal')).toHaveCount(0);
  await expect(page.locator('#covSheet .covnote')).toContainText('总分 100 分不一致');
  await expect(page.locator('#covBarFill')).toHaveCount(1);
});
