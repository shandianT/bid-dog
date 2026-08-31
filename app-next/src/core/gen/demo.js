// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。
// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。
import { S, ui } from '../store.js';
import { handle, select } from './jobs.js';

/* ================= 演示模式 ================= */
function demoBoot(){
  S.jobs=[{job_id:'demo',name:'滨江新区智慧管网(演示)',pct:0,stage:'启动中'}];
  select('demo'); demoRun('demo');
}
function demoNew(name){ const id='demo'+Date.now(); S.jobs.unshift({job_id:id,name:(name||'新任务').replace(/\.[^.]+$/,''),pct:0}); ui.render('tasks'); select(id); demoRun(id); }
// 演示台词:与真实运行同一条展示通道,只是内容是脚本化的样例(在线体验版没有本机引擎,不这样就只剩分隔线)
const DEMO_LOG = {
  '体检素材':['正在检查招标文件与素材库是否完整',
             '素材库定位成功:素材/(公司介绍.md、产品资料.md、产品能力表.md、资质与案例.md、图片索引.md)',
             '图片索引 6 张已登记,均带落位锚点 ✓','招标文件为 PDF → 转换 招标文件_解析版.md(4.2 万字)'],
  '读懂组成':['读 招标文件_解析版.md 第三章「投标文件组成」','识别:技术标 / 商务标 / 报价标 三册分装',
             '附件模板 5 个已登记(投标函、法人授权书、偏离表、承诺函、报价表)','写出 投标文件组成.md'],
  '提取格式':['提取正文字体:宋体小四 / 行距 1.5 倍 / 首行缩进 2 字符','页边距 上下 2.54cm 左右 3.17cm,装订线 0.5cm',
             '页眉带项目名,页码分节(封面目录不编页)','已保存格式规范与摘要'],
  '评分废标':['解析评分办法表:技术分 60 / 商务分 25 / 价格分 15','高分值项 4 处已标【高】:信创适配、AI 修复、并发能力、误报治理',
             '废标条款 7 条逐条登记(★项 3 条)','写出 评分点响应矩阵.md、废标风险清单.md'],
  '拆解分工':['以投标文件组成为骨架设计大纲(技术方案 5 章)','每章生成招标摘录切片:章节切片/第N章_招标摘录.md',
             '写出 00_响应矩阵.md,记录各章 must_cover'],
  '分章撰写':['5 个章节正在并行撰写，不必逐章等待','第1章 项目理解已完成 · 3862 字 ✓',
             '第2章 系统架构已完成 · 4105 字 ✓ · 已标记产品架构图位置',
             '第3章 信创适配已完成 · 3711 字 ✓ · 已标记配图位置',
             '第4章 实施与服务初稿 2980 字，低于要求，正在自动扩写',
             '第4章扩写完成 · 3806 字 ✓','第5章 售后与培训已完成 · 3644 字 ✓'],
  '逐条应答':['读 产品能力表.md(15 项能力,配图列已绑定图片ID)','逐条判定招标要求 32 条:满足 28 / 部分满足 3 / 不满足 1',
             '不满足项已注明替代方案与说明','写出 技术应答偏离表.md、商务偏离表.md'],
  '汇总成册':['正在按招标要求汇总全册',
             '按 投标文件组成.md 顺序拼装,逐字保留各章正文','总字数 19,028(各章之和 19,028,无缩水)',
             '文首插入全局对照表,文末生成《投标人补料清单》'],
  '配图复核':['正在核对配图、篇幅和重复内容',
             '图片核对:6 张索引图 → 打标 5 处','「缺陷检测详情」打标位置与锚点不符 → 自动搬正到「代码缺陷检测」章',
             '「白名单管理」有锚点未打标 → 自动补插到「误报治理」段','查重:未发现重复灌注段;篇幅:5 个论述章均达标 ✓',
             '写出 成品质检报告.md(结论:通过)'],
  '自查体检':['对照 00_响应矩阵.md 核对交付稿','要求覆盖率 100%(32/32) · 评分点覆盖率 100%(18/18)',
             '废标条款 7 条逐条已规避 ✓','人工确认项 3 条已列入补料清单','写出 投标文件自检报告.md'],
  '出Word质检':['正在生成可直接打开的 Word 文件',
               '图片:自动插入 6 张,连续编号图注','正在检查 Word 格式',
               '格式核验 18 项:纸张/页边距/装订线/字体/行距/缩进/页眉页脚/页码分节/目录/封面/表格 全部通过 ✓',
               '质检通过,交付物已就位']
};
function demoRun(id){
  const stages=['体检素材','读懂组成','提取格式','评分废标','拆解分工','分章撰写','逐条应答','汇总成册','配图复核','自查体检','出Word质检'];
  let i=0; handle(id,{type:'message',role:'agent',text:'收到招标文件,开始读。读完我把结构、评分表和要你确认的事列出来。'});
  // 台词逐行吐出:与真实运行观感一致(真实版来自引擎读 run.log 的增量)
  let logQ = [], logT = setInterval(()=>{ if(logQ.length) handle(id,{type:'worklog',lines:[logQ.shift()]}); }, 260);
  const tm=setInterval(()=>{
    if(S.chips[id]){ return; }
    if(i>=stages.length){ clearInterval(tm); setTimeout(()=>clearInterval(logT), 3000);
      handle(id,{type:'artifact',name:'投标文件_技术标.md'}); handle(id,{type:'artifact',name:'投标文件_技术标.docx',size_kb:2180}); handle(id,{type:'artifact',name:'投标文件自检报告.md'});
      handle(id,{type:'progress',stage:'完成',pct:100,step:12,total:12});
      handle(id,{type:'message',role:'agent',text:'已出 Word:全册与自检报告在交付目录。出件前有 3 项要你确认。'});
      handle(id,{type:'health',level:'yellow',summary:'3 项人工确认后即可投',gaps:[
        {level:'red',title:'投标人名称与报价未填',detail:'封面与投标函两处占位符'},
        {level:'yellow',title:'安全生产许可证 2026-06 到期',detail:'评分表要求有效期内'},
        {level:'yellow',title:'项目经理业绩缺一份中标通知书',detail:'要求近三年 2 个同类业绩'},
        {level:'green',title:'格式质检全部通过',detail:'字体/行距/页边距/页码合规'}]});
      return; }
    handle(id,{type:'progress',stage:stages[i],pct:Math.round((i+0.5)/stages.length*100),step:i+1,total:stages.length});
    logQ = logQ.concat(DEMO_LOG[stages[i]] || []);
    if(stages[i]==='评分废标') handle(id,{type:'question',id:'q1',text:'安全生产许可证 2026-06 到期,等你上传新证还是按「即将换证」写?',options:['等我上传新证','按即将换证写']});
    i++;
  },2400);
}
export { demoBoot, demoNew, demoRun, DEMO_LOG };
