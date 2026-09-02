// P4 界面契约:招标对照阅读器(点评分点两边定位)/ 用量看板 / 导入任务包入口 / 分册开关。
// 后端(记账、/v1/usage、导入、分册)由 tests/test_p4_pipeline.py 覆盖;这里验证界面接线。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'p4-compare-fixture';

function node(id, kind, outputs, title, state) {
  return { id, kind, state, model_tier: kind === 'model' ? 'fast' : '', title, outputs, min_chars: 0,
    attempt: 1, attempt_serial: 1, max_attempts: 5, dependencies: [], input_digest: 'digest',
    started_at: '', finished_at: '', last_activity_at: '', error_code: '', retry_after_seconds: 0 };
}

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const job = path.join(home, 'jobs', JOB_ID);
  fs.mkdirSync(job, { recursive: true });
  const ts = '2026-08-03 09:00:00';   // 比其他 fixture 都旧:不抢自动选中
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({ name: 'P4对照任务', tender: '招标文件.docx', created_at: ts }, null, 2));
  fs.writeFileSync(path.join(job, '招标文件_解析版.md'), [
    '# 招标文件(解析版)', '', '## 第三章 评分办法', '',
    '售后服务承诺:响应时间 2 小时以内、到场 4 小时以内得 10 分;每超 1 小时扣 2 分。',
    '培训方案:提供不少于 3 天的现场培训得 5 分。', '', '## 第四章 合同条款', '付款方式按进度支付。', ''].join('\n'));
  fs.writeFileSync(path.join(job, '章节_01_售后服务方案.md'),
    '# 售后服务方案\n\n## 服务承诺\n\n我方承诺响应时间 2 小时,到场 4 小时,7×24 小时热线。\n\n## 服务网点\n\n本地设有服务网点。\n');
  fs.writeFileSync(path.join(job, '评分点响应矩阵.md'), [
    '# 评分点响应矩阵', '', '> 规划来源:模型逐项核对(test-model)', '',
    '| 序号 | 评分项 | 分值 | 响应位置 | 评估标准/证据 | 缺口 |', '|---|---|---:|---|---|---|',
    '| 1 | 售后服务承诺 | 10 分 | 售后服务方案 | 响应时间与到场时间 | 无 |',
    '| 2 | 培训方案 | 5 分 | 〔需补充〕 | 现场培训天数 | 缺章节 |', ''].join('\n'));
  fs.writeFileSync(path.join(job, 'response_plan.json'), JSON.stringify({ source: 'model', model: 'test-model', chapters: [
    { id: 'c1', title: '售后服务方案', output: '章节_01_售后服务方案.md', basis: [], scoring_points: ['售后服务承诺'], material_slots: [], dependencies: [] }] }));
  fs.writeFileSync(path.join(job, 'pipeline.json'), JSON.stringify({
    version: 2, run_id: 'run-p4', mode: 'fast', state: 'running', recoverable: true, current_nodes: [],
    model_routes: { fast: 'test-model', quality: 'test-model' },
    nodes: [
      node('source_parse', 'local', ['招标文件_解析版.md', 'source_manifest.json'], '本地解析招标文件', 'done'),
      node('response_plan', 'model', ['投标文件组成.md', '评分点响应矩阵.md', '废标风险清单.md', 'response_plan.json'], '提取响应规划', 'done'),
      node('chapter_write:c1', 'model', ['章节_01_售后服务方案.md'], '售后服务方案', 'done'),
      node('assemble', 'local', ['投标文件_整册.md'], '汇总整册', 'pending'),
    ], created_at: ts, updated_at: ts }, null, 2));
  fs.writeFileSync(path.join(job, 'usage.json'), JSON.stringify({ calls: 4, input_tokens: 1200, output_tokens: 300, total_tokens: 1500,
    model: 'test-model', estimated: true, by_model: { 'test-model': { calls: 4, input_tokens: 1200, output_tokens: 300 } } }));
  fs.writeFileSync(path.join(job, 'events.jsonl'),
    JSON.stringify({ type: 'progress', stage: '分章撰写', pct: 60, step: 7, total: 12, ts }) + '\n');
});

async function openFixture(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.evaluate(() => closeAll());
  await page.getByText('P4对照任务', { exact: false }).first().click();
  await expect(page.locator('#hTitle')).toHaveText('P4对照任务');
}

test('the compare reader puts tender text and the chapter side by side and a scoring point locates both', async ({ page }) => {
  await openFixture(page);
  await page.locator('#moreBtn').click();                       // 对照阅读收进顶栏「···」
  await expect(page.locator('#compareBtn')).toBeVisible();
  await page.locator('#compareBtn').click();
  await expect(page.locator('#compareSheet')).toBeVisible();
  await expect(page.locator('[data-side="left"] .cmp-line').first()).toContainText('招标文件', { timeout: 10_000 });
  const points = page.locator('#cmpPoints .cmp-pt');
  await expect(points).toHaveCount(2, { timeout: 10_000 });
  await points.first().click();
  await expect(page.locator('[data-side="left"] .cmp-line.first')).toContainText('售后服务承诺');
  await expect(page.locator('[data-side="right"] .cmp-line.first')).toContainText('响应时间 2 小时', { timeout: 10_000 });
  // 第二个评分点没落到章节:左边仍能定位,右边保持当前章
  await points.nth(1).click();
  await expect(page.locator('[data-side="left"] .cmp-line.first')).toContainText('培训方案');
});

test('the usage dashboard lists the job with its estimated token count', async ({ page }) => {
  await openFixture(page);
  await page.locator('#usageLink').click();
  await expect(page.locator('#usageSheet')).toBeVisible();
  await expect(page.locator('#usageTotals')).toContainText('模型调用');
  const row = page.locator('#usageJobs tr', { hasText: 'P4对照任务' });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText('test-model');
  await expect(row).toContainText('≈');            // 网关没返回用量:按字数估,明说
});

test('import and usage are reachable from the palette; the wizard has a volumes switch', async ({ page }) => {
  await openFixture(page);
  await page.keyboard.press('Control+k');
  await page.locator('#paletteInput').fill('导入');
  await expect(page.locator('#paletteList [data-pal="import"]')).toBeVisible();
  await page.locator('#paletteInput').fill('对照');
  await expect(page.locator('#paletteList [data-pal="compare"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#importLink')).toBeVisible();
  await expect(page.locator('#zipin')).toHaveAttribute('accept', '.zip');
  await page.keyboard.press('Control+n');
  await page.evaluate(() => njShowStep(2));
  await expect(page.locator('#njVolumes .ant-switch')).toBeVisible();
  expect(await page.evaluate(() => NJ.volumes)).toBe(false);
  await page.locator('#njVolumes .ant-switch').click();
  expect(await page.evaluate(() => NJ.volumes)).toBe(true);
  await page.evaluate(() => { njReset(); NJ.open = false; renderMain(); });
});
