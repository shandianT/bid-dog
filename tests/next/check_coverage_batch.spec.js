// 【新界面专属】评分点覆盖:按章批量补写。
//
// 经典只能一条一条点「补写应答」,但引擎的单章重写会 _reserve_running_reason 把整单
// 锁成 running:第二条必然被 admission 挡回来。所以一章漏了三条,用户实际只能补一条、
// 等它跑完、再补一条——而且后一次重写还会覆盖前一次的稿子。
// 按章分组、一章一次把该章所有漏项拼进同一条补充要求,既省事也是唯一正确的批法。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'covbatch-fixture';
const CHAPTER = '资格与业绩';

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
  const ts = '2026-08-03 09:00:00';       // 比所有 fixture 都旧:不抢自动选中
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({
    name: '漏了三条的任务', tender: '招标文件.docx', created_at: ts,
  }, null, 2));
  ['章节_01_施工组织设计.md', '章节_02_资格与业绩.md'].forEach((name, i) => {
    fs.writeFileSync(path.join(job, name), `# ${name}\n\n` + '正文段落。\n'.repeat(200));
  });
  // 一章漏三条 + 一条压根没落位:分组后应当是「一个可批量的章节组 + 一拨派不出去的」
  fs.writeFileSync(path.join(job, '评分点响应矩阵.md'), [
    '# 评分点响应矩阵', '',
    '| 序号 | 原要求/评分点 | 分值 | 响应位置 | 证据 | 缺口 |',
    '|---|---|---:|---|---|---|',
    '| 1 | BIM 施工模拟 | 3 | 施工组织设计 | 解析版 | 无 |',
    `| 2 | 近三年类似业绩 | 5 | ${CHAPTER} | 历史标书 | 〔需补充〕第三个案例 |`,
    `| 3 | 项目负责人资格 | 4 | ${CHAPTER} | 〔需补充〕 | 〔需补充〕建造师证扫描件 |`,
    `| 4 | 同类项目获奖 | 2 | ${CHAPTER} | 无 | 〔需补充〕获奖证明 |`,
    '| 5 | 售后服务承诺 | 2 | 〔需补充〕 | 〔需补充〕 | 〔需补充〕 |',
    '',
  ].join('\n'));
  // 停止终态:补写按钮该是可点的(引擎只在整单 running 时拒绝重写)
  fs.writeFileSync(path.join(job, 'outcome.json'), JSON.stringify({
    state: 'stopped', reason: '跑完了但评分点还有缺口',
  }, null, 2));
  fs.writeFileSync(path.join(job, 'pipeline.json'), JSON.stringify({
    version: 2, run_id: 'run-covbatch', mode: 'fast', state: 'running', recoverable: true,
    current_nodes: [], model_routes: { fast: 'test-model', quality: 'test-model' },
    nodes: [
      node('source_parse', 'local', ['招标文件_解析版.md'], '本地解析招标文件', 'done'),
      node('response_plan', 'model', ['评分点响应矩阵.md'], '提取响应规划', 'done'),
      node('chapter_write:c1', 'model', ['章节_01_施工组织设计.md'], '施工组织设计', 'done'),
      node('chapter_write:c2', 'model', ['章节_02_资格与业绩.md'], CHAPTER, 'done'),
      node('assemble', 'local', ['投标文件_整册.md'], '汇总整册', 'pending'),
    ],
    created_at: ts, updated_at: ts,
  }, null, 2));
});

async function openCoverage(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  // 这一单是 stopped 终态,落在默认折叠的「未完成」组里;用经典就有的 select() 测试座
  // 直接切过去,和点侧栏等价(侧栏折叠行为另有 recovery spec 钉住,不在本文件的射程内)。
  await page.waitForFunction(id => (window.S.jobs || []).some(j => j.job_id === id), JOB_ID, { timeout: 15_000 });
  await page.evaluate(id => window.select(id), JOB_ID);
  await expect(page.locator('#hTitle')).toHaveText('漏了三条的任务');
  await expect(page.locator('#covPill')).toContainText('1/5');
  await page.locator('#covPill').click();
  await expect(page.locator('#covSheet')).toBeVisible();
}

test('uncovered points are grouped by the chapter that has to absorb them', async ({ page }) => {
  await openCoverage(page);
  const group = page.locator('[data-covgroup="chapter_write:c2"]');
  await expect(group.locator('.cg-name')).toHaveText(CHAPTER);
  await expect(group.locator('.cg-n')).toHaveText('漏 3 条');
  await expect(group.locator('.covitem')).toHaveCount(3);
  // 派不出去的那条不混进章节组,也不给假按钮
  const orphan = page.locator('[data-covgroup=""] .covitem');
  await expect(orphan).toHaveCount(1);
  await expect(orphan).toContainText('还没落到具体章节');
  await expect(page.locator('#covList .covitem:not(.ok)')).toHaveCount(4);
  await expect(page.locator('#covList .covitem.ok')).toHaveCount(1);
});

test('one batch dispatch carries every missing point of that chapter in a single rewrite', async ({ page }) => {
  const bodies = [];
  await page.route('**/chapters/**/rewrite', async route => {
    bodies.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 'chapter_write:c2', version: 2 }) });
  });
  await openCoverage(page);
  await page.locator('[data-covbatch="chapter_write:c2"]').click();

  // 一次请求,不是三次——引擎一次只接受一章,三次里后两次必然被挡回来
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].url).toContain(encodeURIComponent('chapter_write:c2'));
  const note = bodies[0].body.note;
  expect(note).toContain('近三年类似业绩');
  expect(note).toContain('项目负责人资格');
  expect(note).toContain('同类项目获奖');
  expect(note).toContain('分值 5');
  expect(note).toContain('需补齐:〔需补充〕建造师证扫描件');
  expect(note).not.toContain('售后服务承诺');           // 没落位的那条不该被硬塞进本章
  expect(note.length).toBeLessThanOrEqual(2000);        // 引擎 REWRITE_NOTE_MAX,超了会被截断

  // 派发后面板不关:用户还得看着「这一章下发了、其余等它跑完」
  await expect(page.locator('#covSheet')).toBeVisible();
  await expect(page.locator('[data-covgroup="chapter_write:c2"]')).toContainText('已下发,正在补写');
  await expect(page.locator('#covList')).toContainText('引擎一次只重写一章');
});

test('unchecking a point takes it out of the batch instead of silently sending it', async ({ page }) => {
  const bodies = [];
  await page.route('**/chapters/**/rewrite', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await openCoverage(page);
  const group = page.locator('[data-covgroup="chapter_write:c2"]');
  const batch = page.locator('[data-covbatch="chapter_write:c2"]');
  await expect(batch).toHaveText('一起补写这 3 条');
  await group.locator('.covitem').filter({ hasText: '同类项目获奖' }).locator('input[type="checkbox"]').uncheck();
  await expect(batch).toHaveText('一起补写这 2 条');
  await batch.click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].note).toContain('近三年类似业绩');
  expect(bodies[0].note).not.toContain('同类项目获奖');
});

test('a single-point chapter keeps the one-off button and its classic wording', async ({ page }) => {
  const bodies = [];
  await page.route('**/chapters/**/rewrite', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await openCoverage(page);
  const row = page.locator('#covList .covitem').filter({ hasText: '近三年类似业绩' });
  await expect(row.locator('button')).toHaveText('补写应答');   // 单条派发没被批量取代
  await row.locator('button').click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].note).toContain('补写评分点应答:近三年类似业绩');
  expect(bodies[0].note).not.toContain('项目负责人资格');       // 单条就是单条,不夹带同章其他漏项
});
