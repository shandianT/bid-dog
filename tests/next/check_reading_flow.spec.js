// 【新界面专属】长跑任务的「读得到」契约。
//
// 经典单文件前端里有两条不起眼但决定可用性的规矩,迁移到 React 时容易丢:
//   1. renderChat 滚的是中栏容器 el('chat'),而且只在用户本来就贴着底(nearBottom)时才滚——
//      新消息要自动看得见,但用户上翻读历史时不许把他拽回底部;
//   2. renderWorklog 的 <pre id="wlBody"> 限高可滚,并且只在 stick 时跟到最新一行——
//      一单跑下来台词能有几百行,不限高会把对话顶到几千像素以外。
// 这两条都不在既有 spec 的断言里(经典 spec 只看语义文本),所以单独钉在这里。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const JOB_ID = 'reading-fixture';

test.beforeAll(() => {
  const home = process.env.BID_HOME;
  if (!home) throw new Error('BID_HOME is required for the isolated browser fixture');
  const job = path.join(home, 'jobs', JOB_ID);
  fs.mkdirSync(job, { recursive: true });
  const ts = '2026-08-04 09:00:00';       // 比所有 fixture 都旧:不抢自动选中
  fs.writeFileSync(path.join(job, '招标文件.docx'), 'fixture tender');
  fs.writeFileSync(path.join(job, '任务.json'), JSON.stringify({
    name: '话很多的任务', tender: '招标文件.docx', created_at: ts,
  }, null, 2));
});

// 中栏 .mid 才是滚动容器(经典的 el('chat')),这里统一读它的位置
const midPos = page => page.evaluate(() => {
  const x = document.querySelector('.mid');
  return { top: Math.round(x.scrollTop), max: Math.round(x.scrollHeight - x.clientHeight) };
});

async function openTalkativeJob(page) {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.getByText('话很多的任务', { exact: false }).first().click();
  await expect(page.locator('#hTitle')).toHaveText('话很多的任务');
  await page.locator('#midTabs [data-midtab="chat"]').click();
  // 把对话灌到明显超出一屏——短对话根本不滚,验不出跟随(空对话区高度为 0,先有内容再断言可见)
  await page.evaluate(() => {
    const id = window.S.active, l = (window.S.msgs[id] = window.S.msgs[id] || []);
    for (let i = 1; i <= 30; i++) l.push({ role: i % 2 ? 'user' : 'assistant', text: '压测消息 ' + i });
    window.bump();
  });
  await expect(page.locator('#chatWrap')).toBeVisible();
  await expect.poll(async () => (await midPos(page)).max).toBeGreaterThan(0);
}

const pushMsg = (page, text) => page.evaluate(t => {
  window.S.msgs[window.S.active].push({ role: 'assistant', text: t }); window.bump();
}, text);

test('a new reply scrolls itself into view instead of landing below the fold', async ({ page }) => {
  await openTalkativeJob(page);
  await pushMsg(page, '最新一条回复');
  await expect.poll(async () => { const p = await midPos(page); return p.top === p.max; }).toBe(true);
  // 真正的验收标准是「人眼看得见」:最后一条必须落在视口内,不是仅仅存在于 DOM
  const box = await page.locator('.msg').last().boundingBox();
  const h = page.viewportSize().height;
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(h);
});

test('scrolling up to read history is never interrupted by incoming messages', async ({ page }) => {
  await openTalkativeJob(page);
  await page.evaluate(() => { document.querySelector('.mid').scrollTop = 0; });
  await pushMsg(page, '上翻期间到达的消息');
  await page.waitForTimeout(300);
  expect((await midPos(page)).top).toBe(0);              // 读历史时不许被拽走
  // 回到底部就该重新跟随:这是「不打断」而不是「不再滚」
  await page.evaluate(() => { const x = document.querySelector('.mid'); x.scrollTop = x.scrollHeight; });
  await pushMsg(page, '回到底部后到达的消息');
  await expect.poll(async () => { const p = await midPos(page); return p.top === p.max; }).toBe(true);
});

test('a few hundred worklog lines stay in a scrollable box pinned to the newest line', async ({ page }) => {
  await openTalkativeJob(page);
  await page.evaluate(() => {
    const id = window.S.active, w = (window.S.worklog[id] = window.S.worklog[id] || []);
    w.push('── 第 1 步 · 检查资料 ──');
    for (let i = 1; i <= 200; i++) w.push('第 ' + i + ' 行台词');
    window.bump();
  });
  const box = page.locator('.wl-scroll');
  await expect(box).toBeVisible();
  const m = await box.evaluate(x => ({ h: Math.round(x.clientHeight), sh: Math.round(x.scrollHeight), top: Math.round(x.scrollTop) }));
  expect(m.h).toBeLessThanOrEqual(320);                  // 限高:不再把对话顶到几千像素外
  expect(m.sh).toBeGreaterThan(m.h);                     // 内容确实溢出了,滚动是真的
  expect(Math.abs(m.top - (m.sh - m.h))).toBeLessThanOrEqual(2);   // 停在最新一行
});
