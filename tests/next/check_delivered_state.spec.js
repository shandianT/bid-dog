// 【新界面移植版】断言语义与经典 spec 一字不动;仅替换驱动方式:
// 经典页面把函数挂全局、直接操作 DOM,新界面(app-next,React+core)保留了同名
// 测试座(window.S/handle/renderXxx→失效重渲/closeAll/askConfirm/cfDone 等),
// 所以绝大多数行原样可跑。有改动的行都有「移植:」注释说明等价性。
// 出了整册 Word 但没过质检 ≠ 白跑一场。
//
// 一线实测(v0.20.6):12/12 步全走完,投标文件_整册.docx 就在「最终交付」里,
// 只有最后一道交付门禁没过。界面却通篇「已停止(关键检查未通过)」+ 红色「未完成」。
// 用户的原话:「还是显示未完成,会被误解失败了」。这话是对的——界面把「还差几步」
// 说成了「全砸了」,而且不说差哪几步、怎么补。
const { test, expect } = require('@playwright/test');

const DESKTOP_URL = (process.env.BIDDOG_TEST_URL || 'http://127.0.0.1:18765')
  .replace('127.0.0.1', 'tauri.localhost').replace('localhost:', 'tauri.localhost:');

// 后端 quality_audit 在 red 时真实下发的形状:每条都带 detail(怎么补)与
// actions(可执行动作)。前端过去一条都没渲染。
const HEALTH = {
  level: 'red', summary: '成品质检有必须处理项',
  gaps: [
    { level: 'red', title: '章节「技术方案」字数不足',
      detail: '按报告要求补足后再交付',
      actions: [{ act: 'redo', label: '重做这一章', param: '重写章节「技术方案」' }] },
    { level: 'red', title: '逐项详情见《成品质检报告.md》',
      detail: '字数/图片落位/重复段/应答覆盖率都在报告里,逐条对着改',
      actions: [{ act: 'open_artifact', label: '打开报告', file: '成品质检报告.md' }] },
    { level: 'yellow', title: '也可以对整册不达标章节一起重做',
      detail: '只重做这些章节,其余产物保留,完成后自动重新汇总' },
  ],
};

async function openStoppedWithWord(page) {
  await page.goto(DESKTOP_URL);
  await page.waitForFunction(() => typeof jobHasDeliverable === 'function', null, { timeout: 15_000 });
  await page.evaluate(() => closeAll());
  await page.evaluate(h => {
    const id = 'delivered-1';
    S.jobs = [{ job_id: id, name: '清湖片区棚户区改造', state: 'stopped', has_word: true,
                current_action: '已停止（关键检查未通过）', can: ['redo', 'export'] }];
    S.active = id;
    S.arts[id] = [{ name: '投标文件_整册.docx' }];
    S.artsLoaded[id] = true;
    S.health[id] = h;
    renderHead(); renderRail(); renderTasks();
  }, HEALTH);
}

test('a run that produced the Word is not branded a failure', async ({ page }) => {
  await openStoppedWithWord(page);
  const badge = page.locator('#hBadge');
  await expect(badge).not.toContainText('未完成');       // ← 用户报的就是这一句
  await expect(badge).toHaveText(/待处理/);
  await expect(badge).toHaveClass(/\bwarn\b/);           // 琥珀,不是红
  // 副标题先说出了件,再说还差几项——而不是只报「已停止」
  await expect(page.locator('#hSub')).toContainText('Word 已生成');
  await expect(page.locator('#hSub')).toContainText('提交前需处理 3 项');
});

test('真的没出件时仍然如实报未完成', async ({ page }) => {
  await openStoppedWithWord(page);
  await page.evaluate(() => {
    const id = S.active;
    S.jobs[0].has_word = false; S.arts[id] = []; S.health[id] = null;
    renderHead(); renderRail();
  });
  await expect(page.locator('#hBadge')).toContainText('未完成');
});

test('the blocker card says what to fix, not mangled title fragments', async ({ page }) => {
  await openStoppedWithWord(page);
  await expect(page.locator('#warnT')).toHaveText('提交前需处理 3 项');
  const d = page.locator('#warnD');
  await expect(d).toContainText('章节「技术方案」字数不足');   // 标题完整,不再按空格切碎
  await expect(d).toContainText('按报告要求补足后再交付');     // detail 过去从不渲染
  await expect(d).toContainText('点开看全部 3 项');            // 明确告诉用户有路可走
  await expect(d).not.toHaveText(/^有 · /);                    // 旧实现拼出来的碎片
});

test('the check sheet lists every gap with its fix action', async ({ page }) => {
  await openStoppedWithWord(page);
  await page.evaluate(() => openCheck());
  const rows = page.locator('#ckList .lrow');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('章节「技术方案」字数不足');
  // 后端标签会过一遍 _friendlyActionLabel(「重做」→「修改」,有意为之的措辞),
  // 所以钉的是渲染后的文字和它带的参数,不是后端原始 label。
  const redo = rows.nth(0).locator('[data-eact="redo"]');
  await expect(redo).toHaveText('修改这一章');
  await expect(redo).toHaveAttribute('data-eparam', '重写章节「技术方案」');
  await expect(rows.nth(1).locator('[data-eact="open_artifact"]')).toBeVisible();
  // 后端没给动作的那条不画假按钮:点了没反应比没按钮更糟
  await expect(rows.nth(2).locator('.gap-act')).toHaveCount(0);
});

test('the coverage pill explains why it is short, without opening anything', async ({ page }) => {
  await openStoppedWithWord(page);
  await page.evaluate(() => {
    S.coverage[S.active] = { available: true, total: 19, covered: 0, items: [
      ...Array.from({length: 15}, (_, i) => ({ requirement: 'R'+i, covered: false, reason: 'unlocated' })),
      ...Array.from({length: 4},  (_, i) => ({ requirement: 'G'+i, covered: false, reason: 'gap' })),
    ]};
    renderCovPill();
  });
  const pill = page.locator('#covPill');
  await expect(pill).toContainText('0/19');
  await expect(pill).toHaveAttribute('title', /未覆盖 19 项/);
  await expect(pill).toHaveAttribute('title', /还没落到具体章节 15 项/);
  await expect(pill).toHaveAttribute('title', /规划里还留着缺口 4 项/);
});
