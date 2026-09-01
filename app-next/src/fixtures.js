// 演示数据:形状照抄真引擎(深圳龙华那一单 delivered-pending-review 的真实结构)。
// 原型加载时会先探一次本地引擎(/v1/health),连得上就把任务列表换成真的。
export const JOBS = [
  { id: 'j1', name: '深圳市龙华区清湖片区棚户区改造项目', state: 'attention',
    sub: 'Word 已生成 · 提交前需处理 3 项', pct: 100, active: true },
  { id: 'j2', name: '代码审核平台招标书_模拟脱敏', state: 'running',
    sub: '并行撰写 · 资格与符合性响应', pct: 42 },
  { id: 'j3', name: '副本甘肃省农村信用社灾备项目', state: 'done',
    sub: '7 天前 · 已完成', pct: 100 },
]

export const PHASES = [
  { title: '环境准备', dur: '1 秒' }, { title: '招标解析', dur: '11 分 42 秒' },
  { title: '响应规划', dur: '4 分 08 秒' }, { title: '并行撰写', dur: '38 分 12 秒' },
  { title: 'Word 装配', dur: '2 分 01 秒' }, { title: '交付质检', dur: '进行到 23 秒', warn: true },
]

export const NODES = [
  { name: '交付质检', state: 'done', meta: '第 1/5 次 · 已用 23 秒' },
  { name: '导出 Word', state: 'done', meta: '第 1/5 次 · 已用 5 秒' },
  { name: '交付门禁', state: 'fail', meta: '第 1/5 次 · 已用 17 秒 · local_node_failed', action: '重试当前节点' },
]

export const GAPS = [
  { level: 'error', title: '章节「技术方案」字数不足', detail: '按报告要求补足后再交付', action: '修改这一章' },
  { level: 'error', title: '逐项详情见《成品质检报告.md》', detail: '字数 / 图片落位 / 重复段 / 应答覆盖率都在报告里,逐条对着改', action: '打开报告' },
  { level: 'warning', title: '也可以对整册不达标章节一起重做', detail: '只重做这些章节,其余产物保留,完成后自动重新汇总', action: '继续修改' },
]

export const COVERAGE = { covered: 0, total: 19, unlocated: 15, gap: 4 }

export const FEED = [
  { color: 'red',   text: '交付门禁未通过(local_node_failed),任务停在可恢复检查点', at: '1 小时前' },
  { color: 'green', text: '已导出《投标文件_整册.docx》,并生成成品质检报告', at: '1 小时前' },
  { color: 'green', text: 'Word 装配完成:12 章正文 + 偏离表 + 封面目录', at: '1 小时前' },
  { color: 'blue',  text: '并行撰写完成:资格与符合性响应、项目理解与总体方案等 12 节', at: '2 小时前' },
]

// ── 生成中视图(「看着它干活」,学自 HR 提案 P0-1)──────────────────
export const RUN_JOB = {
  name: '代码审核平台招标书_模拟脱敏', phase: 3,
  sub: '并行撰写 · 正在写「技术方案」 · 已 38 分 12 秒 · 预计还需 ~9 分钟',
}
export const RUN_PHASES = [
  { title: '环境准备', dur: '1 秒' }, { title: '招标解析', dur: '1 分 30 秒' },
  { title: '响应规划', dur: '4 分 08 秒' }, { title: '并行撰写', dur: '进行 38 分 12 秒', live: true },
  { title: 'Word 装配', dur: '通常 2 分钟' }, { title: '交付质检', dur: '通常 2 分钟' },
]
export const CHAPTERS = [
  { n: '项目理解与总体方案', w: 6842, s: 'done' }, { n: '资格与符合性响应', w: 5120, s: 'done' },
  { n: '总体架构与技术路线', w: 7305, s: 'done' }, { n: '功能与技术参数响应', w: 8214, s: 'done' },
  { n: '实施、迁移与集成', w: 6011, s: 'done' },   { n: '安全与合规', w: 5478, s: 'done' },
  { n: '测试、验收与培训', w: 4930, s: 'done' },   { n: '运维与售后服务', w: 5666, s: 'done' },
  { n: '技术方案', w: 3214, s: 'writing' },         { n: '团队、业绩与评分证据', w: 1080, s: 'writing' },
  { n: '技术应答偏离表', w: 0, s: 'queued' },       { n: '商务偏离表', w: 0, s: 'queued' },
]
export const THOUGHTS = [
  { title: '读取评分办法与废标条款', description: '命中 19 个评分点 · 7 条否决项登记进废标风险清单', status: 'success' },
  { title: '检索素材库', description: '复用 3 段资质业绩、2 张系统架构图(按锚点落位)', status: 'success' },
  { title: '撰写「技术方案」', description: '已 3,214 字 · 目标 ≥ 6,000 字 · 每写完一节即存检查点', status: 'pending', blink: true },
  { title: '待办:逐条应答核对', description: '写完全部章节后,对照 19 个评分点逐条核对覆盖', status: 'pending' },
]
export const RUN_COVERAGE = { covered: 12, total: 19 }

// ── Cmd+K 命令面板(学自 HR 提案 P0-2:两次击键到任何地方)──────────
export const PALETTE = [
  { group: '任务', items: ['深圳市龙华区清湖片区棚户区改造项目', '代码审核平台招标书_模拟脱敏', '副本甘肃省农村信用社灾备项目'] },
  { group: '章节', items: ['技术方案', '资格与符合性响应', '商务偏离表', '团队、业绩与评分证据'] },
  { group: '动作', items: ['出件前检查', '打开任务文件夹', '导出 Word', '重新生成'] },
  { group: '问一句', items: ['出件前我还差哪几项?', '为什么交付门禁没过?'] },
]

// ── 重做确认卡:预演 diff(学自 HR 提案 P1-4:批的是具体会发生什么)──
export const REDO_DIFF = [
  { k: '章节「技术方案」', from: '4,213 字 · 质检不达标', to: '重写(目标 ≥ 6,000 字)', hot: true },
  { k: '其余 11 章', from: '已完成', to: '保留不动' },
  { k: '投标文件_整册.docx', from: '当前版本', to: '重做完成后自动重新汇总' },
  { k: '成品质检 + 废标风险清单', from: '有 3 项待处理', to: '自动重跑并更新' },
]
