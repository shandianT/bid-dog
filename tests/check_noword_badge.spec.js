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
  await expect(page.locator('#hAct')).toHaveText('查看未完成原因');

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

    expect(await page.locator('.taskbulk .tbrow').count()).toBeGreaterThanOrEqual(3);
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

test('completed task opens the delivery view first and keeps process diagnostics secondary', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.evaluate(() => {
    const id = 'delivery-contract';
    S.jobs = [{
      job_id:id, name:'智慧园区响应文件', state:'done', has_word:true,
      presentation:{code:'completed',label:'已完成'}, status:'complete',
      current_action:'交付文件已准备好', last_activity_at:new Date().toISOString(), elapsed_seconds:735,
      usage:{calls:18,input_tokens:12000,output_tokens:8600,total_tokens:20600,estimated_cost:0.42,currency:'USD'},
      runtime:{mode:'managed',capabilities:{pause:{enabled:false,reason:'任务已结束'}}},
      delivery:{
        word:{present:true,name:'智慧园区_投标文件.docx',url:''}, ready:true,
        toc:{status:'pass',summary:'目录完整'},
        deviations:{status:'warn',technical:72,business:23,total_rows:95},
        checks:{status:'pass',summary:'内容与格式检查通过'},
      },
    }];
    S.arts[id]=[{name:'智慧园区_投标文件.docx',size_kb:2048}];S.artsLoaded[id]=true;S.active=id;S.processView[id]=false;
    renderTasks();renderMain();
  });

  await expect(page.locator('#resultView')).toBeVisible();
  await expect(page.locator('#resultWordName')).toHaveText('智慧园区_投标文件.docx');
  await expect(page.locator('#resultChecks')).toContainText('目录完整性');
  await expect(page.locator('#resultChecks')).toContainText('共 95 条');
  await expect(page.locator('#resultUsage')).toContainText('20,600 tokens');

  await page.getByRole('button', {name:'过程与诊断'}).click();
  await expect(page.locator('#chat')).toBeVisible();
  await expect(page.locator('#resultTabBtn')).toBeVisible();
  await page.locator('#resultTabBtn').click();
  await expect(page.locator('#resultView')).toBeVisible();
});

test('generation flow console shows evidence, checkpoint, and polling recovery without a giant graph', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.evaluate(() => {
    const id='flow-contract';
    S.jobs=[{job_id:id,name:'政府采购响应文件',state:'running',current_action:'正在提取目录',
      last_activity_at:new Date().toISOString(),flow:{version:1,current_phase:'environment',recoverable:true,
        current_action:'正在检查生成组件',checkpoint:{step:0,label:'任务文件已保存'},phases:[
          {id:'environment',label:'环境准备',state:'active',detail:'正在检查生成组件',evidence:'preflight.json',checks:[
            {id:'storage',label:'任务目录',state:'done',detail:'任务文件可以保存'},
            {id:'runtime',label:'生成组件',state:'active',detail:'正在自动修复'}]},
          {id:'parse',label:'招标解析',state:'pending',detail:'等待读取招标文件'},
          {id:'plan',label:'响应规划',state:'pending'}, {id:'write',label:'并行撰写',state:'pending'},
          {id:'assemble',label:'Word 装配',state:'pending'}, {id:'deliver',label:'交付质检',state:'pending'}
        ]}}];
    S.active=id;S.processView[id]=true;S.streamState[id]={mode:'connected',failures:0};
    renderMain();renderFlowConsole();
  });

  await expect(page.locator('#flowHost')).toBeVisible();
  await expect(page.locator('#flowHost')).toContainText('生成流程台');
  await expect(page.locator('#flowHost')).toContainText('正在检查生成组件');
  await expect(page.locator('#flowHost')).toContainText('任务目录');
  await expect(page.locator('#flowHost')).toContainText('实时连接');
  expect(await page.locator('#flowHost .flow-phase').count()).toBe(6);

  await page.evaluate(() => {
    recordStreamFailure('flow-contract');
    recordStreamFailure('flow-contract');
    recordStreamFailure('flow-contract');
  });
  await expect(page.locator('#flowHost')).toContainText('轮询保障中');
  await page.evaluate(() => markStreamOpen('flow-contract'));
  await expect(page.locator('#flowHost')).toContainText('连接已恢复');
});

test('stable mode explains disabled pause and runtime fallback keeps technical text in diagnostics', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.evaluate(() => {
    const id='stable-job';
    S.online=true;
    S.jobs=[{job_id:id,name:'稳定生成任务',state:'running',presentation:{code:'generating'},current_action:'正在撰写技术方案',
      runtime:{mode:'compatibility',capabilities:{pause:{enabled:false,reason:'稳定模式需保持本轮连续运行'}}}}];
    S.active=id;S.prog[id]={pct:35,step:4,total:12,stage:'正在撰写技术方案'};S.processView[id]=true;
    renderTasks();renderMain();renderHead();
  });
  await expect(page.locator('#pauseBtn')).toBeVisible();
  await expect(page.locator('#pauseBtn')).toHaveAttribute('aria-disabled','true');
  await expect(page.locator('#pauseBtn')).toHaveAttribute('title',/稳定模式|连续运行/);

  await page.evaluate(() => handle('stable-job', {
    type:'message',role:'agent',text:'⚠ 执行外壳起来了但链路没通(执行外壳探活 90 秒没有完整回复),这一单改用兼容模式跑。'
  }));
  await expect(page.locator('#problemHost')).toContainText('连接响应较慢，已自动切换稳定模式，任务正在继续。');
  await expect(page.locator('#problemHost')).not.toContainText('执行外壳');
  await page.locator('#problemHost').getByRole('button',{name:'查看原因'}).click();
  await expect(page.locator('#diagnosticSheet')).toBeVisible();
  await expect(page.locator('#diagnosticDetail')).toContainText('90 秒');
});

test('one-click diagnostics becomes visible immediately above the problem card', async ({ page }) => {
  await page.route('**/v1/diagnostics', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto('/?demo=1');
  await page.evaluate(() => presentProblem({
    level:'error', title:'任务未完成', text:'生成组件没有启动', detail:'spawn failed',
    actions:[{act:'diagnose',label:'一键诊断'}]
  }));

  await page.locator('#problemHost').getByRole('button',{name:'一键诊断'}).click();

  await expect(page.locator('#diagnosticSheet')).toBeVisible();
  await expect(page.locator('#diagnosticStatus')).toContainText('正在检查');
  await expect(page.locator('#problemHost')).toBeHidden();
  const layers = await page.evaluate(() => ({
    diagnostic:Number(getComputedStyle(el('diagnosticSheet')).zIndex),
    problem:Number(getComputedStyle(el('problemHost')).zIndex)
  }));
  expect(layers.diagnostic).toBeGreaterThan(layers.problem);
});

test('desktop engine startup failure is visible and offers diagnostics instead of silent demo mode', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.evaluate(() => showEngineOffline());

  await expect(page.locator('#conn')).toContainText('本地引擎未启动');
  await expect(page.locator('#demoTag')).toContainText('无法生成真实文件');
  await expect(page.locator('#problemHost')).toContainText('本地生成方式没有启动');
  await expect(page.locator('#problemHost').getByRole('button', {name:'一键诊断'})).toBeVisible();
  await expect(page.locator('#heroSub')).not.toContainText('流程可完整体验');
});

test('uploaded bid can be reviewed, saved as a complete template, and used by a staged job', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.evaluate(() => { njOpen(); njShowStep(2); });

  const deriveResponse = page.waitForResponse(response =>
    response.url().includes('/v1/templates/derive') && response.request().method() === 'POST');
  await page.evaluate(async () => {
    const markdown = [
      '# 某单位软件平台项目资格与符合性响应',
      '# 某单位软件平台项目理解与总体方案',
      '# 某单位软件平台功能与技术参数响应',
      '# 某单位软件平台实施进度计划',
      '# 某单位软件平台数据安全与服务保障',
      '# 张三项目经理团队配置',
    ].join('\n\n');
    await deriveTemplateFromFile(new File([markdown], '优秀历史标书.md', {type:'text/markdown'}));
  });
  expect((await deriveResponse).status()).toBe(200);
  await expect(page.locator('#njTemplateDraft')).toContainText('查看完整设计思路');
  await expect(page.locator('#njTemplateDraft')).toContainText('评分响应');
  await expect(page.locator('#njTemplateDraft')).not.toContainText('某单位');
  await expect(page.locator('#njTemplateDraft')).not.toContainText('张三');

  await page.locator('#njDerivedTemplateName').fill('软件项目复用模板');
  const saveResponse = page.waitForResponse(response =>
    /\/v1\/templates$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await page.getByRole('button', {name:'确认并保存模板'}).click();
  const saved = await (await saveResponse).json();
  expect(saved.id).toMatch(/^tpl-/);
  await expect(page.locator('#njTemplate')).toHaveValue(saved.id);

  await page.evaluate(() => {
    const tender = new File(['# 软件信息化平台采购文件\n功能参数、实施、数据安全、信创和运维要求。'], '软件采购文件.md', {type:'text/markdown'});
    NJ.items=[{file:tender,rel:tender.name}];NJ.tenderIdx=0;njRender();
  });
  const jobResponse = page.waitForResponse(response =>
    /\/v1\/jobs$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await page.evaluate(() => njStart(false));
  const job = await (await jobResponse).json();
  const taskPath = path.join(process.env.BID_HOME, 'jobs', job.job_id, '任务.json');
  const stored = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  expect(stored.template_id).toBe(saved.id);
  expect(stored.template_snapshot.package.outline.length).toBeGreaterThanOrEqual(5);
  expect(JSON.stringify(stored.template_snapshot)).not.toContain('某单位');
  expect(JSON.stringify(stored.template_snapshot)).not.toContain('张三');
});

test('double start during delayed recommendation creates only one job', async ({ page }) => {
  let recommends = 0, jobs = 0;
  await page.route('**/v1/templates/recommend', async route => {
    recommends += 1;
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.continue();
  });
  page.on('request', request => {
    if(request.method() === 'POST' && /\/v1\/jobs$/.test(new URL(request.url()).pathname)) jobs += 1;
  });
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.evaluate(() => {
    njOpen();
    const tender = new File(['# 工程施工采购\n施工组织设计、工期、质量安全。'], '工程采购.md', {type:'text/markdown'});
    NJ.items=[{file:tender,rel:tender.name}];NJ.tenderIdx=0;el('njTemplate').value='auto';njRender();
  });

  await page.evaluate(() => Promise.all([njStart(false), njStart(false)]));

  expect(recommends).toBe(1);
  expect(jobs).toBe(1);
  expect(await page.evaluate(() => NJ.starting)).toBe(false);
});

test('starting an auto-template job does not wait for preview recommendation', async ({ page }) => {
  await page.route('**/v1/templates/recommend', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#conn')).toContainText('已连接', { timeout: 15_000 });
  await page.evaluate(() => {
    njOpen();
    const tender = new File(['# 工程施工采购\n施工组织设计、工期、质量安全。'], '工程采购.md', {type:'text/markdown'});
    NJ.items=[{file:tender,rel:tender.name}];NJ.tenderIdx=0;el('njTemplate').value='auto';njRender();
  });

  const jobRequest = page.waitForRequest(request =>
    request.method() === 'POST' && /\/v1\/jobs$/.test(new URL(request.url()).pathname),
    {timeout: 600});
  await page.evaluate(() => { window.__njStartPromise = njStart(false); });
  await jobRequest;
  await page.evaluate(() => window.__njStartPromise);

  expect(await page.evaluate(() => NJ.starting)).toBe(false);
});
