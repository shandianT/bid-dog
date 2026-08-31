// 新建任务向导的状态与提交路径:移植自经典 NJ/njAddFiles/njStart/startStaged。
// 经典从 el('njXxx') 读表单值,这里表单值就存在 NJ 上,由 NewJob.jsx 双向绑定;其余逐字。
import { S, ui, bump, api, select, demoNew, presentProblem } from '../core/index.js';
import { IS_WEB, FORCE_DEMO } from '../core/env.js';

export const NJ = { items: [], tenderIdx: -1, step:1, templateDraft:null, recommendation:null, recommendSeq:0, starting:false,
                    req:'', template:'auto', project:'', saveAssets:true, confirmParse:true, msg:'', open:false };
export const DOCLIKE = f => !/\.(png|jpe?g|gif|bmp|tiff?|zip)$/i.test(f);
/* 默认要求:大多数人不知道该写什么,空着写出来的就是四平八稳的通稿。
   预填一份「投标方案专家」提示词当起点——用户改两句比从零写一段容易得多。
   ⚠ 提示词里不能出现看起来像小标题的名词清单——只写"怎么写"的纪律,不写"要有哪几块"。
   (完整教训见经典源码同位置注释;此文案与经典逐字一致,改动需两边同步) */
export const NJ_DEFAULT_REQ = [
  '# 角色',
  '你是有 30 年经验的投标方案专家,负责编写本项目的投标技术方案。',
  '',
  '# 最重要的三条',
  '1. **每一章的小标题必须依据这一章自己的内容现拟**。严禁给所有章节套用同一组小标题——',
  '   评审一眼就能看出是模板灌水,直接失分。两个章节的小标题重复,就是写砸了。',
  '2. **逐条应答招标文件**。技术规格、商务条款、评分办法里的每一条,都要能在标书里找到',
  '   对应的应答段落或表格行;偏离表的条数要和招标条款条数同量级,不能只挑几条象征性地填。',
  '3. **不编造**。我方身份、产品能力、资质案例一律取自素材库,素材里没有的写〔需补充〕。',
  '',
  '# 写法',
  '- 篇幅按招标文件的分量走,写透为准;凑字数的套话、换个说法重复一遍的段落,一律不要。',
  '- 每一段都要有具体信息:具体的做法、参数、时间、责任人、验收口径。',
  '  写不出具体内容的地方,说明素材不够,标〔需补充〕,不要用空话填满。',
  '- 评分办法要求承诺函的(如违约承诺、服务期满后的服务承诺),直接写出完整承诺函正文。',
  '- 资质 / 业绩 / 合同 / 证照:按招标规定的名称建一个章节整块留位,**不要拆成一个资质一个小标题**',
  '  (公司手上都是现成扫描件,实际是整块粘贴,拆碎了没法贴);写清该放什么,留〔此处粘贴:…〕空白位,',
  '  **不要自动插这类图**——插错一张就是造假风险。',
  '- 配图只做一件事:证明我方对某条技术要求或评分点的响应。不为插图而插图。',
  '- 商务和技术偏离表每份必写;另出一份《评标索引》放在整册最前面(评分项|分值|评估标准|对应章节)。',
  '- 语言专业、严谨,不堆形容词。'
].join('\n');

export function njReset(){ NJ.items = []; NJ.tenderIdx = -1; NJ.step=1;NJ.templateDraft=null;NJ.recommendation=null;NJ.recommendSeq++;
  NJ.req = NJ_DEFAULT_REQ; NJ.template='auto'; NJ.project=''; NJ.msg=''; bump(); }

export function njOpen(){
  NJ.open = true;
  if(!NJ.req.trim()) NJ.req = NJ_DEFAULT_REQ;   // 空着就补默认;用户改过的原样保留
  NJ.step = 1; bump();
}

export function njAddFiles(files, _isFolder){
  if(!files || !files.length) return;
  for(const f of files){
    const rel = (f.webkitRelativePath || f._rel || f.name);
    NJ.items.push({file: f, rel});
  }
  njPickTender();
  if(!NJ.open) njOpen(); else bump();
}

// 主件候选:文档类文件;默认挑文件名像招标文件的,否则第一个文档(经典 njRender 的选主件部分)
export function njPickTender(){
  const docs = NJ.items.map((it,i)=>({i, n: it.rel.split('/').pop()})).filter(x=>DOCLIKE(x.n));
  if(NJ.tenderIdx < 0 || !NJ.items[NJ.tenderIdx] || !DOCLIKE(NJ.items[NJ.tenderIdx].rel)){
    const hit = docs.find(x=>/招标|采购|磋商|询价|tender|rfp/i.test(x.n)) || docs[0];
    NJ.tenderIdx = hit ? hit.i : -1;
  }
  return docs;
}

export async function njStart(startNow){
  if(NJ.tenderIdx < 0 || !NJ.items[NJ.tenderIdx]){ NJ.msg='还没有招标文件——点「+ 文件」把它加进来'; bump(); return; }
  if(NJ.starting)return;
  NJ.starting=true; NJ.msg=''; bump();
  try{
    if(IS_WEB && !FORCE_DEMO && typeof Notification!=='undefined' && Notification.permission==='default') Notification.requestPermission();
    const tender = NJ.items[NJ.tenderIdx],tname = tender.rel.split('/').pop();
    if(!S.online){ NJ.open=false; ui.closeAll(); demoNew(tname); njReset(); return; }
    const fd = new FormData();fd.append('tender', tender.file, tname);
    const rest = NJ.items.filter((_,i)=>i!==NJ.tenderIdx),rels = [];
    for(const it of rest){ fd.append('files', it.file, it.rel.split('/').pop()); rels.push(it.rel); }
    fd.append('relpaths', JSON.stringify(rels));fd.append('name', tname.replace(/\.[^.]+$/,''));
    fd.append('prompt', NJ.req.trim());fd.append('template_id', NJ.template || 'auto');
    fd.append('project_id', NJ.project.trim());fd.append('start', startNow ? '1' : '0');
    fd.append('save_to_assets', NJ.saveAssets ? '1' : '0');
    fd.append('confirm_parse', NJ.confirmParse ? '1' : '0');
    const createKey = 'create-'+(typeof crypto!=='undefined'&&crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(16).slice(2));
    try{
      const r = await api('/v1/jobs', {method:'POST', headers:{'Idempotency-Key':createKey}, body:fd});
      S.jobs = await api('/v1/jobs'); NJ.open=false; ui.closeAll(); njReset(); select(r.job_id);
      if(!startNow) ui.toast('已暂存。想跑的时候点任务标题旁的「开始生成」');
    }catch(e){ NJ.msg='创建失败:'+(e&&e.message||'没连上本地服务'); }
  }finally{
    NJ.starting=false; bump();
  }
}

export async function startStaged(){
  if(!S.active) return;
  S._startBusy = true; bump();
  try{ await api('/v1/jobs/'+S.active+'/start', {method:'POST'}); S.jobs = await api('/v1/jobs'); ui.render('tasks'); ui.render('head'); }
  catch(e){ ui.toast('启动失败,请重试'); }
  finally{ S._startBusy = false; bump(); }
}

// 参考资料(经典 addRef/pickRef 的数据路径;文件选择由视图触发)
export async function addRef(file){
  if(!file || !S.active) return;
  const fd = new FormData(); fd.append('file', file);
  try{
    await api('/v1/jobs/'+S.active+'/attachments', {method:'POST', body:fd});
    ui.toast('已加入参考资料,AI 撰写时会参考它的写法');
    const { loadAtts } = await import('../core/index.js');
    loadAtts(S.active);
  }
  catch(e){ ui.toast('参考资料上传失败'); }
}

// 拖入的目录递归展开(webkitGetAsEntry);普通文件直接收(经典 walkEntries 逐字)
export function walkEntries(items, done){
  const out = []; let pend = 0, walked = false;
  const finish = ()=>{ if(pend===0 && walked) done(out); };
  const readDir = (dir, base)=>{
    pend++;
    const rd = dir.createReader();
    const batch = ()=>rd.readEntries(es=>{
      if(!es.length){ pend--; finish(); return; }
      for(const en of es){
        if(en.isFile){ pend++; en.file(f=>{ f._rel = base + en.name; out.push(f); pend--; finish(); }, ()=>{ pend--; finish(); }); }
        else if(en.isDirectory) readDir(en, base + en.name + '/');
      }
      batch();                                   // 目录一次最多返回 100 项,要读到空为止
    }, ()=>{ pend--; finish(); });
    batch();
  };
  for(const it of (items||[])){
    const en = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if(en && en.isDirectory) readDir(en, en.name + '/');
    else { const f = it.getAsFile && it.getAsFile(); if(f) out.push(f); }
  }
  walked = true; finish();
}
