// 命令面板的条目(纯函数,不碰 DOM / React):任务切换 + 动作 + 外观。ctx 提供回调与状态。
export const THEME_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' };
export const FONT_LABELS = { sm: '小', md: '标准', lg: '大' };

export function paletteItems(query, ctx){
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  const add = (group, key, label, hint, run, keys) => out.push({ group, key, label, hint: hint || '', run, keys: keys || '' });
  (ctx.jobs || []).forEach(j => add('任务', 'job:' + j.job_id, j.name || j.job_id,
    (ctx.stateLabel ? ctx.stateLabel(j) : '') + (j.job_id === ctx.active ? ' · 当前' : ''),
    () => ctx.selectJob(j.job_id), 'task job switch 切换 任务'));
  add('动作', 'new', '新建任务', '⌘N · 选择招标文件开始', ctx.newJob, 'new create 新建');
  if(ctx.active){
    add('动作', 'check', '出件前检查', '必办 / 建议 / 已通过', ctx.openCheck, 'check gate 质检 检查');
    add('动作', 'coverage', '评分点覆盖', '每个评分点落到哪一章', ctx.openCoverage, 'coverage score 覆盖 评分');
    if(ctx.canRedo) add('动作', 'redo', '修改结果', '指到某一章就只改那一章', ctx.openRedo, 'redo revise 修改');
    if(ctx.hasResult) add('动作', 'result', ctx.showingResult ? '过程与诊断' : '交付结果', '', ctx.toggleResult, 'result process 交付 过程');
    if(ctx.canCompare) add('动作', 'compare', '对照阅读', '左招标原文 · 右标书章节', ctx.openCompare, 'compare read 对照 阅读 招标');
    add('动作', 'log', '运行日志', '', ctx.openLog, 'log 日志');
    add('动作', 'folder', '任务文件夹', '', ctx.openFolder, 'folder open 文件夹');
  }
  add('动作', 'assets', '素材库', '公司资料 / 图片 / 过往标书', ctx.openAssets, 'assets material 素材');
  add('动作', 'capability', '产品能力表', '应答判定的第一依据,表格里直接改', ctx.openCapability, 'capability 能力表 产品 应答');
  add('动作', 'usage', '用量看板', 'token / 费用 / 耗时 / 复读率', ctx.openUsage, 'usage tokens cost 用量 费用 看板');
  add('动作', 'ab', '试跑对比(A/B)', '同一份招标按模型 / 参数各跑一单', ctx.openAb, 'ab compare 对比 试跑 模型');
  add('动作', 'import', '导入任务包', '同事导出的 zip,接着改', ctx.importZip, 'import zip 导入');
  add('动作', 'settings', '设置 · 模型接入', '', ctx.openSettings, 'settings model 设置 模型');
  add('动作', 'update', '检查更新', '', ctx.checkUpdate, 'update version 更新 版本');
  const prefs = ctx.prefs || {};
  const themeKeys = { system: 'theme system auto 跟随 系统 主题 外观', light: 'theme light 浅色 亮色 主题 外观', dark: 'theme dark 深色 夜间 主题 外观' };
  Object.keys(THEME_LABELS).forEach(k => add('外观', 'theme:' + k, '外观:' + THEME_LABELS[k],
    prefs.theme === k ? '当前' : '', () => ctx.setPrefs({ theme: k }), themeKeys[k]));
  Object.keys(FONT_LABELS).forEach(k => add('外观', 'font:' + k, '字号:' + FONT_LABELS[k],
    prefs.fontScale === k ? '当前' : '', () => ctx.setPrefs({ fontScale: k }), 'font size 字号 字体'));
  if(!q) return out;
  return out.filter(it => (it.label + ' ' + it.hint + ' ' + it.keys + ' ' + it.group).toLowerCase().includes(q));
}
