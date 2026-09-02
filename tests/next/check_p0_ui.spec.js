// 【新界面移植版】断言语义与经典 spec 一字不动;仅替换驱动方式:
// 经典页面把函数挂全局、直接操作 DOM,新界面(app-next,React+core)保留了同名
// 测试座(window.S/handle/renderXxx→失效重渲/closeAll/askConfirm/cfDone 等),
// 所以绝大多数行原样可跑。有改动的行都有「移植:」注释说明等价性。
// P0 界面冒烟:标书大纲主视图 / 页签 / 评分点覆盖仪表 / 单章重写入口 / 解析确认卡。
// 后端行为由 tests/test_p0_features.py 覆盖;这里只验证界面接线,重写/确认请求用路由拦截。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'p0-fixture';

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
  const ts = '2026-08-06 09:00:00';   // 比 half-fixture 旧:不抢其他 spec 的自动选中
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({
    name: 'P0大纲任务', tender: '招标文件.docx', created_at: ts, confirm_parse: true,
  }, null, 2));
  fs.writeFileSync(path.join(job, '章节_01_施工组织设计.md'),
    '# 施工组织设计\n\n' + '施工部署与总体安排。\n'.repeat(200));
  fs.writeFileSync(path.join(job, '评分点响应矩阵.md'), [
    '# 评分点响应矩阵', '',
    '| 序号 | 原要求/评分点 | 分值 | 响应位置 | 证据 | 缺口 |',
    '|---|---|---:|---|---|---|',
    '| 1 | BIM 施工模拟 | 3 | 施工组织设计 | 解析版 | 无 |',
    '| 2 | 近三年类似业绩 | 5 | 资格与业绩 | 历史标书 | 〔需补充〕第三个案例 |',
    '| 3 | 售后服务承诺 | 2 | 〔需补充〕 | 〔需补充〕 | 〔需补充〕 |',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(job, 'pipeline.json'), JSON.stringify({
    version: 2, run_id: 'run-p0', mode: 'fast', state: 'running', recoverable: true,
    current_nodes: [], model_routes: { fast: 'test-model', quality: 'test-model' },
    nodes: [
      node('source_parse', 'local', ['招标文件_解析版.md', 'source_manifest.json'], '本地解析招标文件', 'done'),
      node('response_plan', 'model', ['投标文件组成.md', '评分点响应矩阵.md', '废标风险清单.md', 'response_plan.json'], '提取响应规划', 'done'),
      node('chapter_write:c1', 'model', ['章节_01_施工组织设计.md'], '施工组织设计', 'done'),
      node('chapter_write:c2', 'model', ['章节_02_资格与业绩.md'], '资格与业绩', 'running'),
      node('assemble', 'local', ['投标文件_整册.md'], '汇总整册', 'pending'),
    ],
    created_at: ts, updated_at: ts,
  }, null, 2));
  const events = [
    { type: 'progress', stage: '响应规划已完成，等待确认关键信息后开始分章撰写', pct: 45, step: 6, total: 12, ts },
    {
      type: 'question', id: 'confirm_parse:run-p0', kind: 'confirm_parse',
      text: '开始分章撰写前，请确认解析出的关键信息。',
      options: ['确认无误，开始撰写'],
      payload: {
        project: 'P0大纲任务', deadline: '2026-09-15 09:30', qualification: '施工总承包壹级',
        scoring: '共 3 个评分点 · 综合评估法', veto: '共 2 条废标/否决风险：资格、签章',
      }, ts,
    },
  ];
  fs.writeFileSync(path.join(job, 'events.jsonl'), events.map(x => JSON.stringify(x)).join('\n') + '\n');
});

async function openFixture(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.getByText('P0大纲任务', { exact: false }).first().click();
  await expect(page.locator('#outlineHost')).toBeVisible();   // 0.22.1:两个页签,有章节的任务默认打开「展示」(大纲 + 执行过程)
}

test('pipeline job opens on the document tab: chapter list left, chapter text right', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('#outlineHost .sec-title')).toHaveText('标书大纲');
  const rows = page.locator('#outlineHost .outline-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('施工组织设计');
  await expect(rows.nth(0)).toContainText('约');           // 已完成章节展示字数
  // 默认打开第一章写完的:右边正文区带「重写本章」
  await expect(rows.nth(0)).toHaveClass(/\bsel\b/);
  await expect(page.locator('#docPane [data-rw]')).toHaveText('重写本章');
  // 任务在等确认,章节「正在撰写」只是停下那一刻的快照:大纲不能跟顶栏徽章打架
  await expect(rows.nth(1)).toContainText('等你确认后接着写');
  await rows.nth(1).click();
  await expect(page.locator('#docPane')).toContainText('资格与业绩');   // 右边跟着切
  await expect(page.locator('#docPane [data-rw]')).toHaveCount(0);   // 没写完的章节没有重写入口
  await rows.nth(0).click();
  // 两个页签:「标书」放目录、正文与执行过程,「对话」放聊天;切过去再切回来,标书还在
  await expect(page.locator('#midTabs button.on')).toContainText('标书');
  await page.locator('#midTabs [data-midtab="chat"]').click();
  await expect(page.locator('#chatWrap')).toBeVisible();
  await expect(page.locator('#outlineHost')).toHaveCount(0);
  await page.locator('#midTabs [data-midtab="show"]').click();
  await expect(page.locator('#outlineHost')).toBeVisible();
});

test('waiting-for-confirmation pauses the clock and never shows the missing-word red badge', async ({ page }) => {
  await openFixture(page);
  // 等确认 = 暂停等人:进度回放保持真实步数(流水线节点证据),计时停摆,不挂红牌
  await expect(page.locator('#etaTop')).toHaveText('等待你确认 · 不计时');
  const curstep = page.locator('#miniProg .curstep');
  await expect(curstep).toContainText('等待你确认');
  await expect(curstep).not.toContainText('没出 Word');
  // 引擎自己的检查点是第 8 步(已写完一章)。回放事件里那句 step=6 是更旧的快照,
  // 界面取两者较大值,跟引擎口径一致——既不被钳回 1/12,也不停留在过期的 6/12。
  await expect(curstep).toContainText('8/12');
});

test('coverage pill counts plan rows against chapter completion and offers targeted fixes', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('#covPill')).toContainText('1/3');   // 仪表在右栏评分点卡的标题行,折叠也看得见
  await page.locator('#covPill').click();
  await expect(page.locator('#covSheet')).toBeVisible();
  const items = page.locator('#covList .covitem:not(.ok)');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('近三年类似业绩');
  await expect(items.nth(0).locator('button')).toHaveText('补写应答');   // 定位到章节 → 可一键补写
  await expect(items.nth(1)).toContainText('还没落到具体章节');            // 未落位 → 提示走对话
  await expect(page.locator('#covList .covitem.ok')).toHaveCount(1);
});

test('single-chapter rewrite dialog sends the note to the rewrite endpoint', async ({ page }) => {
  let body = null;
  await page.route('**/chapters/**/rewrite', async route => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, node_id: 'chapter_write:c1', version: 2 } });
  });
  await openFixture(page);
  await page.locator('[data-rw="chapter_write:c1"]').click();
  await expect(page.locator('#rwSheet')).toBeVisible();
  await expect(page.locator('#rwSheet')).toContainText('只重做这一章');
  await page.locator('#rwNote').fill('突出本地化施工经验');
  await page.locator('#rwGo').click();
  await expect(page.locator('#rwSheet')).toBeHidden();
  expect(body).toEqual({ note: '突出本地化施工经验' });
});

test('confirm-parse question renders a structured card and accepting answers it', async ({ page }) => {
  let answered = null;
  await page.route('**/v1/jobs/' + JOB_ID + '/answers', async route => {
    answered = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, delivered: true } });
  });
  await openFixture(page);
  const card = page.locator('#confirmHost .confirm-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('P0大纲任务');
  await expect(card).toContainText('2026-09-15 09:30');
  await expect(card).toContainText('废标');
  await card.locator('[data-cffix]').click();                 // 修正输入区可展开
  await expect(page.locator('#cfFix')).toBeVisible();
  await card.locator('[data-cfok]').click();
  await expect(page.locator('#confirmHost .confirm-card')).toBeHidden();
  expect(answered.question_id).toBe('confirm_parse:run-p0');
  expect(answered.choice).toBe('确认无误，开始撰写');
});
