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
