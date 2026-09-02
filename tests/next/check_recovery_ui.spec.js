// 【新界面移植版】断言语义与经典 spec 一字不动;仅替换驱动方式:
// 经典页面把函数挂全局、直接操作 DOM,新界面(app-next,React+core)保留了同名
// 测试座(window.S/handle/renderXxx→失效重渲/closeAll/askConfirm/cfDone 等),
// 所以绝大多数行原样可跑。有改动的行都有「移植:」注释说明等价性。
// 半路停下来的任务:界面必须让人看出「停在哪」并且「怎么接着跑」。
//
// 三条真实故障路径,都在一线截图里出现过:
// 1. /v1/jobs 对每一单都下发 runtime.capabilities={pause:{...}},前端拿它整体遮蔽了
//    can 列表,于是 can 里的 resume 永远读不到——任务写着「可从检查点继续」,顶栏却没有
//    「从断点继续」按钮,用户被困在半成品任务上;
// 2. 重开应用后 SSE 实时步数是 0,右栏进度条全灰、写「启动中」,而检查点明明在第 8 步;
// 3. 还在写第 3/5 章、按一下就能接着跑的任务被挂上「没出 Word,未完成」红牌——它缺的是
//    「还没跑完」,不是「交付物丢了」,红牌会让人以为白干了。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'recovery-fixture';
const CHAPTERS = [
  ['c1', '项目理解与总体方案', 'done'],
  ['c2', '施工组织设计', 'done'],
  ['c3', '质量保证体系', 'done'],
  ['c4', '售后服务方案', 'pending'],
  ['c5', '资格与业绩', 'pending'],
];

function node(id, kind, outputs, title, state, extra) {
  return Object.assign({
    id, kind, state, model_tier: kind === 'model' ? 'fast' : '', title,
    outputs, min_chars: 0, attempt: state === 'pending' ? 0 : 1, attempt_serial: 1,
    max_attempts: 5, dependencies: [], input_digest: state === 'done' ? 'digest' : '',
    started_at: '', finished_at: '', last_activity_at: '', error_code: '', retry_after_seconds: 0,
  }, extra || {});
}

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const job = path.join(home, 'jobs', JOB_ID);
  fs.mkdirSync(job, { recursive: true });
  const ts = '2026-08-05 09:00:00';       // 比其他 fixture 都旧:不抢自动选中
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({
    name: '半路停下的任务', tender: '招标文件.docx', created_at: ts,
  }, null, 2));
  CHAPTERS.filter(c => c[2] === 'done').forEach(([, title], i) => {
    fs.writeFileSync(path.join(job, `章节_0${i + 1}_${title}.md`),
      `# ${title}\n\n` + `${title}的详细论述。\n`.repeat(200));
  });
  // 停止终态 + 可恢复流水线 = 后端会在 can 里给出 resume
  fs.writeFileSync(path.join(job, 'outcome.json'), JSON.stringify({
    state: 'stopped', reason: '应用重启，可从检查点继续',
  }, null, 2));
  fs.writeFileSync(path.join(job, 'pipeline.json'), JSON.stringify({
    version: 2, run_id: 'run-recovery', mode: 'fast', state: 'running', recoverable: true,
    nodes: [
      node('source_parse', 'tool', ['解析版招标文件.md'], '解析招标文件', 'done'),
      node('response_plan', 'model', ['评分点响应矩阵.md'], '规划应答', 'done'),
      ...CHAPTERS.map(([id, title, state], i) => node(
        `chapter_write:${id}`, 'model', [`章节_0${i + 1}_${title}.md`], title, state,
        { dependencies: ['response_plan'] })),
      node('assemble', 'tool', ['投标文件_整册.md'], '汇总全文', 'pending'),
      node('word_export', 'tool', ['投标文件_整册.docx'], '导出 Word', 'pending'),
    ],
  }, null, 2));
});

async function openStoppedJob(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.getByText('半路停下的任务', { exact: false }).first().click();
  await expect(page.locator('#hTitle')).toHaveText('半路停下的任务');
  await expect(page.locator('#flowHost')).toBeVisible();
}

test('a stopped-but-resumable job offers the resume button instead of a dead end', async ({ page }) => {
  await openStoppedJob(page);
  // 后端确实给了 resume,界面就必须给按钮——否则「可从检查点继续」这句话就是空头支票。
  const jobs = await page.evaluate(async () => (await fetch('/v1/jobs')).json());
  expect((jobs.find(j => j.job_id === 'recovery-fixture') || {}).can).toContain('resume');
  await expect(page.locator('#resumeBtn')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText('从断点继续');
  // 归档这类后端从不下发的能力不能被 can 列表连坐关掉
  await expect(page.locator(`#tasks .task[data-id="${JOB_ID}"]`)).toContainText('归档');
});

test('progress falls back to the persisted checkpoint instead of resetting to zero', async ({ page }) => {
  await openStoppedJob(page);
  const rail = page.locator('#miniProg');
  await expect(rail).not.toContainText('启动中');          // 停下的任务不该说自己在启动
  await expect(rail).toContainText('已停止');
  await expect(rail).toContainText('8/12');                // 检查点在第 8 步,不是 0
  await expect(page.locator('#etaTop')).toContainText('不计时');   // 停了就别再倒计时
  await expect(page.locator('#miniProg .ticks i.d')).toHaveCount(7);
});

test('a run that stopped before assembly is not flagged as missing its Word', async ({ page }) => {
  await openStoppedJob(page);
  await expect(page.locator('#hBadge')).toHaveText('未完成');
  await expect(page.locator('#hBadge')).not.toContainText('没出 Word');
  await expect(page.locator('#hAct')).toHaveText('出件前检查');
  await expect(page.locator('#miniProg')).not.toContainText('没出 Word');
});

test('the flow console header and node rows follow the real state', async ({ page }) => {
  await openStoppedJob(page);
  await page.evaluate(() => { S.flowOpen[S.active] = true; bump(); });   // 0.22.1:执行过程是「展示」里可收起的一段
  await expect(page.locator('#flowHost .flow-kicker')).toHaveText('已停止');   // 不再写死「生成进行中」
  const pending = page.locator('#flowHost .flow-node-row.pending').first();
  await expect(pending).toBeVisible();
  await expect(pending).not.toContainText('尚未提供节点详情');                 // 内部术语不外泄
  await expect(pending).toContainText('排队等待');
});

test('the task you are looking at stays visible in a collapsed sidebar group', async ({ page }) => {
  await openStoppedJob(page);
  const row = page.locator(`#tasks .task[data-id="${JOB_ID}"]`);
  await expect(row).toBeVisible();          // 「未完成」组默认折叠,但当前这一单要钉出来
  await expect(row).toHaveClass(/\bon\b/);
});
