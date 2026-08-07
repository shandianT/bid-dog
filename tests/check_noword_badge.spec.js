const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'half-fixture';

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const job = path.join(home, 'jobs', JOB_ID);
  fs.mkdirSync(job, { recursive: true });
  const ts = '2026-08-07 12:00:00';
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '招标文件_解析版.md'), '解析依据\n'.repeat(300));
  fs.writeFileSync(path.join(job, 'run.log'), 'synthetic upstream interrupted\n');
  fs.writeFileSync(
    path.join(job, '任务.json'),
    JSON.stringify({ name: '只有解析件的中断任务', tender: '招标文件.docx', created_at: ts }, null, 2),
  );
  fs.writeFileSync(
    path.join(job, 'progress.json'),
    JSON.stringify({ type: 'progress', stage: '已停止（生成中断）', pct: 2, step: 1, total: 12, terminal: true, ts }, null, 2),
  );
  fs.writeFileSync(
    path.join(job, 'outcome.json'),
    JSON.stringify({ state: 'stopped', reason: '已停止（生成中断）', ts }, null, 2),
  );
  const events = [
    { type: 'progress', stage: '已停止（生成中断）', pct: 2, step: 1, total: 12, terminal: true, ts },
    {
      type: 'health', level: 'red', summary: '没有可交付的 Word——这一单还没完成', ts,
      gaps: [{
        level: 'red', title: '没出 Word，未完成', detail: '当前只有解析/分析文件。',
        actions: [{ act: 'open_log', label: '查看运行日志' }, { act: 'rerun', label: '重跑本任务' }],
      }],
    },
  ];
  fs.writeFileSync(path.join(job, 'events.jsonl'), events.map(x => JSON.stringify(x)).join('\n') + '\n');
});

test('no Word is a red badge and its recovery action calls the engine', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await expect(page.locator('#hBadge')).toContainText('没出 Word，未完成');
  await expect(page.locator('#hAct')).toHaveText('查看中断原因');

  await page.locator('#hAct').click();
  await expect(page.locator('#check')).toBeVisible();
  await expect(page.locator('#ckTitle')).toContainText('没有可交付的 Word');

  const logRequest = page.waitForResponse(
    response => response.url().includes(`/v1/jobs/${JOB_ID}/log`) && response.status() === 200,
  );
  await page.getByText('查看运行日志', { exact: true }).click();
  await logRequest;
  await expect(page.locator('#logSheet')).toBeVisible();
  await expect(page.locator('#logBody')).toContainText('synthetic upstream interrupted');
});

test('batch toolbar and destructive confirmation stay inside a narrow viewport', async ({ page }) => {
  for(const width of [320, 390, 768]) {
    await page.setViewportSize({width, height: 844});
    await page.goto('/?demo=1');
    await page.evaluate(() => {
      S.jobs = Array.from({length: 12}, (_, i) => ({
        job_id: `mobile-${i}`,
        name: `移动任务 ${i}`,
        state: i < 6 ? 'unknown' : 'done',
      }));
      setTaskBulkMode(true);
      toggleAllTaskSelection();
      S.active = S.jobs[0].job_id;
      renderMain();
    });

    await expect(page.locator('.taskbulk .tbrow')).toHaveCount(2);
    const layout = await page.locator('.taskbulk').evaluate(toolbar => {
      const rect = element => {
        const r = element.getBoundingClientRect();
        return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height};
      };
      const bar = rect(toolbar);
      const main = rect(document.querySelector('main'));
      const rows = [...toolbar.querySelectorAll('.tbrow')].map(row => ({
        box: rect(row),
        children: [...row.children].map(rect),
      }));
      const count = rect(toolbar.querySelector('.tbsp'));
      return {bar, main, rows, count, scrollWidth:toolbar.scrollWidth, clientWidth:toolbar.clientWidth};
    });
    expect(layout.main.width).toBeGreaterThanOrEqual(width - 1);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.count.height).toBeLessThanOrEqual(24);
    for(const row of layout.rows) {
      for(const child of row.children) {
        expect(child.left).toBeGreaterThanOrEqual(row.box.left - 1);
        expect(child.right).toBeLessThanOrEqual(row.box.right + 1);
      }
    }
    const buttonHeights = await page.locator('.taskbulk button').evaluateAll(buttons =>
      buttons.map(button => button.getBoundingClientRect().height));
    expect(Math.min(...buttonHeights)).toBeGreaterThanOrEqual(44);

    await page.evaluate(() => { askConfirm('确认批量删除 12 个任务?', '删除后不可恢复', true); });
    const confirmBox = await page.locator('#confirm').boundingBox();
    expect(confirmBox).not.toBeNull();
    expect(confirmBox.x).toBeGreaterThanOrEqual(0);
    expect(confirmBox.x + confirmBox.width).toBeLessThanOrEqual(width);
    await page.evaluate(() => cfDone(false));
  }
});
