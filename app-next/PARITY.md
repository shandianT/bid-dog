# 迁移契约(冻结)——新界面必须与 main + PR #10 功能等价

基准:`app/src/index.html`(4304 行,0.20.6)+ PR #10(claude/delivered-not-failed)的 45 行增量。
本文件是验收清单:每一项在新界面可用并有对应测试之前,迁移不算完成。**只许加强,不许缩水。**

## 移植三原则

1. **纯逻辑原样移植**:`FRONTEND_STABILITY_PURE_START/END` 标记块(1017–1379 行)与
   handle()/SSE 重连/timing() 等状态机代码逐字搬入 `src/core/`,只把 `renderX()` 换成
   `ui.render('x')`、DOM 触点换成 ui 适配器。语义漂移=事故。
2. **测试座保留**:`window.S / handle / applyHealthUpdate / renderUpdateSteps 等全局暴露不变,
   既有 Playwright spec 只改选择器,断言语义一字不动。
3. **同一展示通道**:演示模式(demoRun)与真实 SSE 走同一个 handle(),不做第二套渲染路径。

## 子系统清单(15)

| # | 子系统 | 源函数(基准行号) | 迁移状态 |
|---|---|---|---|
| 1 | 连接与引导 | findEngine/goOnline/showEngineOffline/boot/onboarding (1559–1863) | core+视图 |
| 2 | 纯视图模型 | 标记块全部 24 个函数 + jobHasDeliverable (#10) | core/pure.js 逐字 |
| 3 | API 层 | api() AbortController/requestId/version_sunset (1385–1424) | core/api.js 逐字 |
| 4 | SSE 与任务选择 | select/attachES/handle/重连退避/轮询降级/visibilitychange (2491–2721) | core/jobs.js 逐字 |
| 5 | 计时 | ts2ms/fmtDur/timing/stageAvgs ETA (2723–2770) | core/jobs.js 逐字 |
| 6 | 任务列表 | renderTasks/taskRow/批量/归档/项目筛选/删除 (2147–2489) | 视图 A |
| 7 | 头部与快捷 | renderHead(#10 待处理徽章+lead)/renderQuick/暂停/继续/停止/重跑 (2771–2963) | 视图 A |
| 8 | 执行过程 | renderFlowConsole/flowConsoleView/renderWorklog/节点重试(errAction) (1885–1910, 2934–3099) | 视图 A |
| 9 | P0 大纲/覆盖/重写 | renderOutline/renderCovPill(#10 title)/openCoverage/openRewrite/submitRewrite/确认卡 (1911–2101) | 视图 B |
| 10 | 交付与右栏 | renderResult/deliveryViewModel 消费/renderRail(#10 warnD)/openPreview/openArtifact (2103–2145, 3101–3268) | 视图 B |
| 11 | 新建任务向导 | NJ 三步/模板推荐-派生-保存/拖放含文件夹/幂等键 (3270–3579) | 视图 C |
| 12 | 对话 | send/say/answerMode/answer/ASK_SELF 自救入口 (3581–3635) | 视图 C |
| 13 | 弹层与问题 | askConfirm/openSheet/closeAll/presentProblem 三段式/runDiagnostics/repair (1465–1557, 3637–3692) | core+视图 C |
| 14 | 模型接入 | providers/agent/极速-质量模式 qkApplyMode/provisionShell/testAgent (3694–4154) | 视图 D |
| 15 | 素材库/更新面板/演示 | assets+vision (4156–4232)/更新四步交互 (1579–1727)/demo (4234–4300) | core+视图 D |

## API 端点(28,全部保留)

/v1/health · /v1/jobs(GET/POST/bulk/scope=archived) · /v1/jobs/{id}(events SSE/artifacts/attachments/pipeline/coverage/chapters/{node}/rewrite/export) · /v1/agent(+provision/test) · /v1/assets(+config/ingest/open/vision_index/scope=ingested) · /v1/diagnostics · /v1/open_release · /v1/providers(+probe_models/{id}) · /v1/relay/models · /v1/setup(+complete/connect) · /v1/stats/stages · /v1/templates(+derive/recommend/{id})

## 语义红线(既有测试钉住的,逐条列举)

- 出了整册 Word 的失败任务 ≠ 失败:徽章「待处理」amber,首句「Word 已生成」(#10)
- 「没出 Word,未完成」红牌只给 deliveryDeadEnd(不可 resume)的任务
- SSE 历史回放不得改写任务状态(eventIsRecent 门),只补进度数字
- 断流退避 3/4/6/10s,3 次失败降级轮询;stream_reset 清空重放状态
- 进度条 = max(SSE live step, 落盘 checkpoint step),重开不清零
- 阶段耗时不可信(>20×常规且>30min,或>12h)时退回「通常 X」
- can 列表只对 CAN_LIST_AUTHORITATIVE 枚举的动作有发言权;runtime.capabilities 与 can 合并不遮蔽
- 稳定模式(cli/compat)禁暂停,给 pauseReason
- 更新:三步真实事件、无 Content-Length 不编百分比、运行中任务先警告「仍然更新」、重启遮罩
- 版本徽章可点=手动检查更新;离线点击说清原因
- api():超时/网络错误分开措辞;version_sunset 弹全局横幅;Idempotency-Key 建任务;retry_dispatch_failed 才清重试键
- 文案翻译层 _friendlyText/_friendlyActionLabel 全保留(黑话→人话)
- 演示模式 ?demo=1:纯前端完整流程,含提问-回答-出件-质检黄牌
- 对话新消息自动跟到底,但用户上翻读历史时不打断(滚的是中栏 .mid,阈值 90px)
- 工作日志限高可滚(300px),只在用户本来就贴着底时跟到最新一行(阈值 30px)

## 生成效果提升(本次迁移随带,引擎不动)

1. 重写弹层 = 预演 diff + **自动带入该章未覆盖评分点作为补充要求**(用现有 rewrite note 通道)
2. 撰写中每章字数/覆盖实时可见(现有 pipeline/coverage 端点,4s 事件驱动刷新),薄章早发现早补
3. 覆盖仪表的「补写应答」一键派发保留并放到更显眼的层级
4. 覆盖面板按章分组,**一章一次把该章所有漏项拼进同一条补充要求**——引擎重写时会把整单
   锁成 running,逐条派发的后几条必然被挡回,且后一次重写会盖掉前一次的稿子;分组即批次。
   随之把引擎侧 note 上限从 500 提到 2000(`generation_pipeline.REWRITE_NOTE_MAX`):
   覆盖表单条最长约 300 字(原要求 140 + 缺口 140),500 装不下两条整批。

## 明确不做(与用户约定一致)

漏斗视图、URL 分享(桌面单机无此场景);契约生成/统一事件流(后端工程,另行评估);引擎与提示词改动(另一里程碑)。
