// 应用更新面板:把"点一下然后干等"换成看得见的三步。
//
// 之前的形态是:侧栏文字变一下 + 一条 2.6 秒就消失的 toast,然后几十秒到几分钟毫无动静。
// 用户只会以为卡死了反复点,每点一次多起一个并发下载。这里验证三件事:
// 1. 三个步骤都对应 Rust 真的播上来的事件,没有硬凑出来的假步骤;
// 2. 服务端没给 Content-Length 时,显示"已下载 X MB"而不是编一个百分比;
// 3. 有任务正在生成时,更新前必须先说清"会停在检查点、之后能从断点继续"——
//    这是中标狗独有的一层:更新要重启,重启会打断生成。
const { test, expect } = require('@playwright/test');

// IS_WEB 由 hostname 判定(tauri.localhost = 桌面壳)。走这个主机名才能测到桌面分支,
// 而不是给 const 打补丁绕过判断。
const DESKTOP_URL = (process.env.BIDDOG_TEST_URL || 'http://127.0.0.1:18765')
  .replace('127.0.0.1', 'tauri.localhost').replace('localhost:', 'tauri.localhost:');

// 「新版」的版本号是虚构的,可以写死;「当前」不能——它来自真实引擎,每次升版都会变。
// 第一版把当前版写死成 '0.20.5',升到 0.20.6 时这条用例立刻断了。断言该钉的是
// 「当前 → 新版」这个形态和真实取值,不是某两个具体数字。
const NEXT_VERSION = '9.9.9';
const runningVersion = page => page.evaluate(() => S.engineVersion || BUNDLED_ENGINE_VERSION);
const UPDATE_HEALTH = {
  update: {
    available: true, latest: NEXT_VERSION,
    url: 'https://github.com/shandianT/bid-dog/releases/latest',
    notes: '• 修复「从断点继续」按钮不出现\n• 进度条重开应用后不再清零',
  },
};

// 桌面壳只连它自己那一版的专属引擎端口,测试引擎不在那个端口上——所以这里引擎是"未连接"的。
// 这恰好是更有价值的场景:引擎起不来的时候,用户更需要能把应用更新掉。更新面板本就
// 不依赖引擎(版本信息来自 health 快照,任务列表来自内存状态),这里一并把这条性质钉住。
async function openDesktop(page) {
  await page.goto(DESKTOP_URL);
  await page.waitForFunction(() => typeof window.openUpdatePanel === 'function', null, { timeout: 15_000 });
  expect(await page.evaluate(() => IS_WEB)).toBe(false);
  await page.evaluate(() => closeAll());          // 关掉首次运行引导/离线提示
}

test('the sidebar always shows the running version and turns into an update entry', async ({ page }) => {
  await openDesktop(page);
  await expect(page.locator('#brandVer')).toHaveText(/^v\d+\.\d+\.\d+$/);   // 版本号常驻
  await expect(page.locator('#updateLink')).toBeHidden();                   // 没新版就不打扰

  await page.evaluate(h => applyHealthUpdate(h), UPDATE_HEALTH);
  await expect(page.locator('#updateLink')).toBeVisible();
  await expect(page.locator('#updateLink')).toContainText('v' + NEXT_VERSION);
  await expect(page.locator('#brandVer')).toHaveClass(/\bnew\b/);           // 同一行就地变蓝
});

test('the update panel names every step instead of spinning silently', async ({ page }) => {
  await openDesktop(page);
  await page.evaluate(h => applyHealthUpdate(h), UPDATE_HEALTH);
  await page.evaluate(() => el('updateLink').onclick());

  await expect(page.locator('#updSheet')).toBeVisible();
  await expect(page.locator('#updTitle')).toHaveText('有新版本 v' + NEXT_VERSION);
  await expect(page.locator('#updVersions'))
    .toHaveText('当前 v' + (await runningVersion(page)) + ' → 新版 v' + NEXT_VERSION);
  await expect(page.locator('#updNotes')).toContainText('从断点继续');       // 更新说明照实显示
  const steps = page.locator('#updSteps .upd-step');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('下载安装包');
  await expect(steps.nth(1)).toContainText('校验签名并安装');
  await expect(steps.nth(2)).toContainText('重启应用');
});

test('download progress reflects real bytes, and never fakes a percentage', async ({ page }) => {
  await openDesktop(page);
  await page.evaluate(h => applyHealthUpdate(h), UPDATE_HEALTH);
  await page.evaluate(() => el('updateLink').onclick());

  // 有 Content-Length:百分比 + 进度条
  await page.evaluate(() => renderUpdateSteps('download', 21_000_000, 42_000_000));
  await expect(page.locator('#updSteps .upd-step').nth(0)).toContainText('50%');
  await expect(page.locator('#updSteps .upd-bar b')).toHaveAttribute('style', /width:\s*50%/);

  // 进到安装:上一步必须变成"已完成",否则用户不知道下载到底完没完
  await page.evaluate(() => renderUpdateSteps('install', 0, 0));
  await expect(page.locator('#updSteps .upd-step').nth(0)).toHaveClass(/\bdone\b/);
  await expect(page.locator('#updSteps .upd-step').nth(1)).toHaveClass(/\bactive\b/);

  // 没有 Content-Length:只报已下载多少,不编百分比,也不画一条假进度条
  await page.evaluate(() => renderUpdateSteps('download', 5_242_880, 0));
  await expect(page.locator('#updSteps .upd-step').nth(0)).toContainText('5.0 MB');
  await expect(page.locator('#updSteps .upd-step').nth(0)).not.toContainText('%');
  await expect(page.locator('#updSteps .upd-bar')).toHaveCount(0);
});

test('updating while a job is generating warns before the restart, not after', async ({ page }) => {
  await openDesktop(page);
  await page.evaluate(h => applyHealthUpdate(h), UPDATE_HEALTH);
  // 更新会重启,重启会打断生成。这一句必须在按钮按下去之前出现。
  await page.evaluate(() => {
    S.jobs = [{ job_id: 'busy-1', name: '正在生成的任务', state: 'running',
                presentation: { code: 'generating' }, can: ['stop', 'ask'] }];
  });
  await page.evaluate(() => openUpdatePanel());

  const warn = page.locator('#updWarn');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('1 个任务正在生成');
  await expect(warn).toContainText('从断点继续');      // 告诉用户断了也能接着跑
  await expect(page.locator('#updGo')).toHaveText('仍然更新');   // 措辞承认代价

  // 没有运行中的任务时不应该吓唬人
  await page.evaluate(() => { S.jobs = []; openUpdatePanel(); });
  await expect(page.locator('#updWarn')).toBeHidden();
  await expect(page.locator('#updGo')).toHaveText('立即更新');
});

test('the restart overlay explains the gap between install and relaunch', async ({ page }) => {
  await openDesktop(page);
  await expect(page.locator('#updRestart')).toBeHidden();
  // Rust 在 app.restart() 之前播 restarting;这几秒没有交代就像卡死了
  await page.evaluate(() => {
    renderUpdateSteps('install', 0, 0);
    el('updRestart').style.display = 'flex';
  });
  await expect(page.locator('#updRestart')).toBeVisible();
  await expect(page.locator('#updRestart')).toContainText('正在重启应用');
  await expect(page.locator('#updRestart')).toContainText('不要手动关闭');
});

// 已经是最新版时,界面上关于更新原本什么都不显示——想主动确认「我是不是最新的」
// 无处可点。被动通知和主动查询是两件事,两条路都得有。
test('the version badge is the manual check-for-updates entry, not just a label', async ({ page }) => {
  await openDesktop(page);
  const badge = page.locator('#brandVer');
  await expect(badge).toHaveAttribute('role', 'button');      // 可点,且对键盘可达
  await expect(badge).toHaveAttribute('tabindex', '0');
  await expect(badge).toHaveAttribute('title', /检查更新/);
  await expect(page.locator('#updateLink')).toBeHidden();      // 没新版时侧栏入口本就不该出现

  // 引擎未连接时点它:说清为什么不能查,而不是静默什么都不发生
  await page.evaluate(() => { S.online = false; });
  await page.evaluate(() => checkForUpdate());
  await expect(page.locator('#toast')).toContainText('本地服务未连接');

  // 已知有新版时点它 = 直接进更新面板,不必再查一遍
  await page.evaluate(h => applyHealthUpdate(h), UPDATE_HEALTH);
  await page.evaluate(() => checkForUpdate());
  await expect(page.locator('#updSheet')).toBeVisible();
  await expect(page.locator('#updTitle')).toHaveText('有新版本 v' + NEXT_VERSION);
});
