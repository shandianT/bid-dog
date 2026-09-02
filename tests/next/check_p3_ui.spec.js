// P3 界面契约:右栏按任务阶段折叠 / 出件前检查分组 / ⌘K 命令面板与 ⌘N ⌘⏎ 快捷键 /
// 「待处理」独立色阶 / 外观(深色)与字号偏好 / 新建向导三开关 / Word 真预览(docx → HTML)。
// 后端 docx 渲染由 tests/test_docx_preview.py 覆盖;这里验证界面接线。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'p3-word-fixture';

const HEALTH = {
  level: 'red', summary: '成品质检有必须处理项',
  gaps: [
    { level: 'red', title: '章节「技术方案」字数不足', detail: '按报告要求补足后再交付',
      actions: [{ act: 'redo', label: '重做这一章', param: '重写章节「技术方案」' }] },
    { level: 'red', title: '逐项详情见《成品质检报告.md》', detail: '逐条对着改',
      actions: [{ act: 'open_artifact', label: '打开报告', file: '成品质检报告.md' }] },
    { level: 'yellow', title: '也可以对整册不达标章节一起重做', detail: '只重做这些章节' },
  ],
};

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const job = path.join(home, 'jobs', JOB_ID);
  fs.mkdirSync(job, { recursive: true });
  const ts = '2026-08-04 09:00:00';   // 比其他 fixture 都旧:不抢自动选中
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({ name: 'P3真预览任务', tender: '招标文件.docx', created_at: ts }, null, 2));
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'p3_word.docx'), path.join(job, '投标文件_整册.docx'));
  fs.writeFileSync(path.join(job, 'events.jsonl'),
    JSON.stringify({ type: 'progress', stage: '全部完成', pct: 100, step: 12, total: 12, ts }) + '\n');
});

async function openApp(page) {
  // 用 baseURL(127.0.0.1)而不是 tauri.localhost:后者会被当成桌面壳,去等 Tauri 拉起引擎
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.waitForFunction(() => typeof renderRail === 'function');
  await page.evaluate(() => { closeAll(); setPrefs({ theme: 'light', fontScale: 'md' }); });
}

async function stoppedWithWord(page, health) {
  await page.evaluate(h => {
    const id = 'p3-delivered';
    S.jobs = [{ job_id: id, name: '清湖片区棚户区改造', state: 'stopped', has_word: true,
                current_action: '已停止（关键检查未通过）', can: ['redo', 'export'] }];
    S.active = id; S.processView[id] = true;
    S.arts[id] = [{ name: '投标文件_整册.docx' }]; S.artsLoaded[id] = true;
    S.health[id] = h;
    renderHead(); renderRail(); renderTasks(); renderMain();
  }, health);
}

test('the rail folds by phase: delivered opens delivery and checks, generating opens progress', async ({ page }) => {
  await openApp(page);
  await stoppedWithWord(page, HEALTH);
  await expect(page.locator('#rail')).toHaveAttribute('data-phase', 'delivered');
  await expect(page.locator('[data-rail="deliver"]')).toHaveAttribute('data-open', '1');
  await expect(page.locator('[data-rail="check"]')).toHaveAttribute('data-open', '1');
  await expect(page.locator('[data-rail="progress"]')).toHaveAttribute('data-open', '0');
  await expect(page.locator('#warnT')).toHaveText('提交前需处理 3 项');   // 结论行常驻,折叠也不丢
  // 手动展开进度:内容回来
  await page.locator('[data-rail="progress"] .rc-title').click();
  await expect(page.locator('[data-rail="progress"]')).toHaveAttribute('data-open', '1');
  await expect(page.locator('#miniProg .curstep')).toBeVisible();
  // 换成生成中:规则重新接管——进度展开、检查折叠,但标题行的 #warnT 仍在
  await page.evaluate(() => {
    const id = 'p3-running';
    S.jobs = [{ job_id: id, name: '生成中的任务', state: 'running', current_action: '分章撰写' }];
    S.active = id; S.prog[id] = { pct: 40, step: 5, total: 12, stage: '分章撰写' };
    S.health[id] = null; S.arts[id] = []; S.artsLoaded[id] = true;
    renderHead(); renderRail(); renderTasks(); renderMain();
  });
  await expect(page.locator('#rail')).toHaveAttribute('data-phase', 'generating');
  await expect(page.locator('[data-rail="progress"]')).toHaveAttribute('data-open', '1');
  await expect(page.locator('[data-rail="check"]')).toHaveAttribute('data-open', '0');
  await expect(page.locator('#warnT')).toHaveText('出件前检查');
});

test('the check sheet groups gaps into 必办 / 建议 with one primary action per group', async ({ page }) => {
  await openApp(page);
  await stoppedWithWord(page, HEALTH);
  await page.evaluate(() => openCheck());
  const groups = page.locator('#ckList .ckgrp');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-ckgrp', 'red');
  await expect(groups.nth(0).locator('.ckgrp-head .ant-tag')).toHaveText('必办 2');
  await expect(groups.nth(0).locator('.ckgrp-act')).toHaveText('定向重做不达标章节');
  await expect(groups.nth(0).locator('.ckgrp-act')).toHaveAttribute('data-eact', 'open_redo');
  await expect(groups.nth(0).locator('.lrow')).toHaveCount(2);
  await expect(groups.nth(1)).toHaveAttribute('data-ckgrp', 'yellow');
  await expect(groups.nth(1).locator('.ckgrp-head .ant-tag')).toHaveText('建议 1');
  await expect(groups.nth(1).locator('.ckgrp-act')).toHaveCount(0);   // 建议组没有可执行的主动作就不画
  await expect(page.locator('#ckList .lrow')).toHaveCount(3);          // 老契约:每条 gap 仍各占一行
});

test('待处理 gets its own colour, distinct from 需要你确认', async ({ page }) => {
  await openApp(page);
  await stoppedWithWord(page, HEALTH);
  const badge = page.locator('#hBadge');
  await expect(badge).toHaveText(/待处理/);
  await expect(badge).toHaveClass(/\bpending\b/);
  const pendingColor = await badge.evaluate(el => getComputedStyle(el).color);
  await page.evaluate(() => {
    const id = S.active; S.jobs[0].state = 'needs_input'; S.jobs[0].has_word = false; S.arts[id] = []; S.health[id] = null;
    S.chips[id] = { qid: 'q1', text: '请确认' }; renderHead();
  });
  await expect(page.locator('#hBadge')).toHaveText(/需要你确认/);
  const confirmColor = await page.locator('#hBadge').evaluate(el => getComputedStyle(el).color);
  expect(pendingColor).not.toBe(confirmColor);
});

test('⌘K opens the command palette; a typed command switches the theme and the choice persists', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.locator('#paletteInput').fill('深色');
  await expect(page.locator('#paletteList .pal-item.on')).toContainText('外观:深色');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#palette')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('biddog.prefs')).theme)).toBe('dark');
  // 字号档位整体缩放 5 档字阶
  await page.evaluate(() => setPrefs({ fontScale: 'lg' }));
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', 'lg');
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--fs-scale'))).toBe('1.1');
  await page.evaluate(() => setPrefs({ theme: 'light', fontScale: 'md' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // ⌘K 也能切任务
  await page.keyboard.press('Control+k');
  await page.locator('#paletteInput').fill('P3真预览');
  await page.keyboard.press('Enter');
  await expect(page.locator('#hTitle')).toHaveText('P3真预览任务');
});

test('⌘N opens the wizard whose requirements are three switches, with the full prompt folded away', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+n');
  await expect(page.getByText('放入文件')).toBeVisible();
  await page.evaluate(() => njShowStep(2));
  const rows = page.locator('#njReqSwitches .req-sw');
  await expect(rows).toHaveCount(3);
  expect(await page.evaluate(() => NJ.req.includes('《评标索引》'))).toBe(true);
  await page.locator('#njReqSwitches [data-req="itemized"] .ant-switch').click();
  expect(await page.evaluate(() => NJ.req.includes('《评标索引》'))).toBe(false);
  expect(await page.evaluate(() => NJ.req.includes('2. **不编造**'))).toBe(true);     // 序号重排
  await expect(page.locator('#njReq')).toBeHidden();                                   // 全文默认折叠
  await page.getByText('高级 · 查看 / 修改完整要求').click();
  await page.locator('#njReq').fill('# 自定义要求\n只写技术方案。');
  expect(await page.evaluate(() => NJ.reqCustom)).toBe(true);
  await expect(rows.first().locator('.ant-switch')).toBeDisabled();                    // 自定义后开关让位
  await page.getByText('恢复为开关生成的版本').click();
  expect(await page.evaluate(() => NJ.reqCustom)).toBe(false);
  await page.evaluate(() => { njReset(); NJ.open = false; renderMain(); });
});

test('the Word preview renders the real docx content, not a markdown stand-in', async ({ page }) => {
  await openApp(page);
  await page.getByText('P3真预览任务', { exact: false }).first().click();
  await expect(page.locator('#hTitle')).toHaveText('P3真预览任务');
  await page.evaluate(() => openPreview('投标文件_整册.docx', ''));
  const body = page.locator('#pvBody');
  await expect(body).toHaveClass(/\bdocx\b/, { timeout: 15_000 });
  await expect(body.locator('.docxpage h1')).toHaveText('投标文件');
  await expect(body.locator('.docxpage p.a-center b')).toHaveText('P3 真预览示例项目 · 技术标');
  await expect(body.locator('.docxpage table tr')).toHaveCount(2);
  await expect(body.locator('.docxpage hr.pb')).toHaveCount(1);
  await expect(body.locator('.docxpage h2')).toHaveText('售后服务方案');
  await expect(page.locator('.pv-stats')).toContainText('真实 Word 内容');
});

test('⌘⏎ sends the composer draft', async ({ page }) => {
  await openApp(page);
  await page.getByText('P3真预览任务', { exact: false }).first().click();
  await expect(page.locator('#composer')).toBeVisible();
  await page.locator('#midTabs [data-midtab="chat"]').click();
  await page.route('**/v1/jobs/*/messages', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  const box = page.locator('#composer textarea').first();
  await box.fill('各章分别写了多少字?');
  await box.press('Control+Enter');
  await expect(page.locator('#chatWrap .msg.u').last()).toContainText('各章分别写了多少字?');
  await expect(box).toHaveValue('');
});
