// 【新界面专属】「修改结果」先判范围:指到一章就只重写那一章,别整单重跑。
//
// 以前点「修改结果」一律建子任务从头跑全部节点——写「第 2 章把响应时间改成 2 小时」
// 要等所有章节重写完。现在停顿 400ms 就问引擎 /revisions/plan,把范围先亮出来:
// 只改一章(走单章重写通道,旧稿进历史版本)/ 整册出新版本;用户可手动改范围。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'revroute-fixture';

function node(id, kind, outputs, title, state) {
  return {
    id, kind, state, model_tier: kind === 'model' ? 'fast' : '', title,
    outputs, min_chars: 0, attempt: 1, attempt_serial: 1, max_attempts: 5,
    dependencies: [], input_digest: 'digest', started_at: '', finished_at: '',
    last_activity_at: '', error_code: '', retry_after_seconds: 0,
  };
}

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const job = path.join(home, 'jobs', JOB_ID);
  fs.mkdirSync(job, { recursive: true });
  const ts = '2026-08-01 09:00:00';
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({
    name: '要改一章的任务', tender: '招标文件.docx', created_at: ts,
  }, null, 2));
  ['章节_01_技术方案.md', '章节_02_售后服务方案.md'].forEach(name => {
    fs.writeFileSync(path.join(job, name), `# ${name}\n\n` + '正文段落。\n'.repeat(200));
  });
  fs.writeFileSync(path.join(job, 'outcome.json'), JSON.stringify({ state: 'stopped', reason: '固定夹具' }, null, 2));
  fs.writeFileSync(path.join(job, 'pipeline.json'), JSON.stringify({
    version: 2, run_id: 'run-revroute', mode: 'fast', state: 'done', recoverable: true,
    current_nodes: [], model_routes: { fast: 'test-model', quality: 'test-model' },
    nodes: [
      node('source_parse', 'local', ['招标文件_解析版.md'], '本地解析招标文件', 'done'),
      node('response_plan', 'model', ['评分点响应矩阵.md'], '提取响应规划', 'done'),
      node('chapter_write:c1', 'model', ['章节_01_技术方案.md'], '技术方案', 'done'),
      node('chapter_write:c2', 'model', ['章节_02_售后服务方案.md'], '售后服务方案', 'done'),
      node('chapter_write:technical_deviation', 'model', ['技术应答偏离表.md'], '技术应答偏离表', 'done'),
      node('assemble', 'local', ['投标文件_整册.md'], '汇总整册', 'done'),
    ],
    created_at: ts, updated_at: ts,
  }, null, 2));
});

async function openRedo(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.waitForFunction(id => (window.S.jobs || []).some(j => j.job_id === id), JOB_ID, { timeout: 15_000 });
  await page.evaluate(id => window.select(id), JOB_ID);
  await expect(page.locator('#hTitle')).toHaveText('要改一章的任务');
  await page.locator('#redoBtn').click();
  await expect(page.locator('#rwInstruction')).toBeVisible();
}

test('an instruction that names a chapter is routed to a single-chapter rewrite', async ({ page }) => {
  await openRedo(page);
  const sent = [];
  await page.route('**/v1/jobs/*/chapters/*/rewrite', async route => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.locator('#rwInstruction').fill('第2章 把响应时间改成 2 小时');
  await expect(page.locator('#rwScope')).toBeVisible();
  await expect(page.locator('#rwPlan')).toContainText('只重写「售后服务方案」');
  await expect(page.locator('#rwRouteReason')).toContainText('售后服务方案');
  await page.getByRole('button', { name: '只改这一章' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toContain('/chapters/chapter_write%3Ac2/rewrite');
  expect(sent[0].body.note).toContain('第2章');
});

test('a whole-book instruction keeps the new-version path and says every chapter will be rewritten', async ({ page }) => {
  await openRedo(page);
  await page.locator('#rwInstruction').fill('整册把公司名统一为 XX 科技');
  await expect(page.locator('#rwScope')).toBeVisible();
  await expect(page.locator('#rwPlan')).toContainText('所有章节都会重写');
  await expect(page.getByRole('button', { name: '开始修改' })).toBeVisible();
});
