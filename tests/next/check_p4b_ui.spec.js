// P4b 界面契约:产品能力表编辑器(表格改、保存到素材库)/ 待确认事实(勾选后确认入库)/ 试跑对比入口。
// 后端(读写规范素材、事实抽取与确认、A/B 起单)由 tests/test_p4b.py 覆盖;这里验证界面接线,走真实引擎。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const FACT_ID = 'abcdef0123456789';

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const facts = path.join(home, '素材库', '事实抽取');
  fs.mkdirSync(facts, { recursive: true });
  fs.writeFileSync(path.join(facts, FACT_ID + '.json'), JSON.stringify({
    id: FACT_ID, source: '2025 年某某项目投标文件.docx', ts: '2026-09-02 09:00:00', status: 'pending', model: 'test-model', count: 3,
    facts: { company: { name: '某某科技有限公司', intro: '成立于 2010 年' },
             qualifications: [{ name: '建筑业企业资质', level: '壹级', issuer: '住建厅', valid_until: '2028-06' }],
             performances: [], people: [{ name: '张三', title: '项目经理', certs: '一级建造师' }] } }, null, 2));
});

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.evaluate(() => closeAll());
}

test('the capability table opens as a grid, a row can be added and the file lands in the asset folder', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { S.sheet = { name: 'assets' }; renderMain(); });
  await page.locator('#capOpen').click();
  await expect(page.locator('#capSheet')).toBeVisible();
  await expect(page.locator('#capStatus')).toContainText('模板');            // 素材库还没有能力表
  await expect(page.locator('#capTable tbody tr.ant-table-row')).toHaveCount(1);          // 模板自带一行示例
  await page.locator('#capAdd').click();
  await expect(page.locator('#capTable tbody tr.ant-table-row')).toHaveCount(2);
  await page.locator('#capTable tbody tr.ant-table-row').nth(1).locator('input').first().fill('用户权限分级');
  await page.locator('#capSave').click();
  await expect(page.locator('#capStatus')).toContainText('已保存');
  const saved = await page.evaluate(async () => (await (await fetch('/v1/assets/text?name=' + encodeURIComponent('产品能力表.md'))).json()));
  expect(saved.exists).toBe(true);
  expect(saved.text).toContain('| 用户权限分级 |');
  expect(saved.text).toContain('| 功能 | 支持情况 | 版本要求 | 证明材料 | 可定制 | 配图 |');
});

test('pending facts show up in the asset library and a confirmation writes them into the canonical files', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { S.sheet = { name: 'assets' }; renderMain(); });
  const card = page.locator('#factsPanel [data-fact="' + FACT_ID + '"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('某某科技有限公司');
  await expect(card).toContainText('张三 · 项目经理 · 一级建造师');
  // 摘掉人员那条,再确认
  await card.locator('.fact-row', { hasText: '张三' }).locator('input[type=checkbox]').click();
  await card.locator('.fact-confirm').click();
  await expect(card).toBeHidden({ timeout: 10_000 });
  const intro = await page.evaluate(async () => (await (await fetch('/v1/assets/text?name=' + encodeURIComponent('公司介绍.md'))).json()).text);
  const cases = await page.evaluate(async () => (await (await fetch('/v1/assets/text?name=' + encodeURIComponent('资质与案例.md'))).json()).text);
  expect(intro).toContain('某某科技有限公司');
  expect(intro).not.toContain('张三');
  expect(cases).toContain('建筑业企业资质');
});

test('the A/B trial lives in settings and the palette reaches capability table and A/B', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+k');
  await page.locator('#paletteInput').fill('能力表');
  await expect(page.locator('#paletteList [data-pal="capability"]')).toBeVisible();
  await page.locator('#paletteInput').fill('试跑');
  await expect(page.locator('#paletteList [data-pal="ab"]')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#abPanel')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#abRun')).toBeVisible();
  await expect(page.locator('#abVariants')).toBeVisible();
});
