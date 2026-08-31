// 产物打开/下载/文件夹:逐字对应经典 openArtifact/openJobFolder/downloadResultWord。
import { S, ui, api, deliveryViewModel } from '../core/index.js';
import { IS_WEB, net } from '../core/env.js';

export async function openArtifact(name, url){
  if(!name) return;
  if(IS_WEB){
    if(!url && S.active){ const hit=(S.arts[S.active]||[]).find(a=>a.name===name); url=hit&&hit.url; }
    if(url){ const a=document.createElement('a'); a.href=net.API+url; a.download=name; a.click(); }
    else ui.toast('这个文件还没有可用的下载地址');
    return;
  }
  if(!S.online || !S.active){ ui.toast('本地服务未连接，暂时无法打开文件'); return; }
  try{
    await api('/v1/jobs/'+S.active+'/artifacts/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    ui.toast('已用默认应用打开');
  }catch(e){ ui.toast('打开失败，请点“打开任务文件夹”手动查看'); }
}

export async function openJobFolder(){
  if(!S.online || !S.active){ ui.toast('请先选择一个已创建的任务'); return; }
  if(IS_WEB){ ui.toast('网页模式不能打开你电脑上的任务文件夹'); return; }
  try{ await api('/v1/jobs/'+S.active+'/open_folder',{method:'POST'}); }
  catch(e){ ui.toast('任务文件夹打开失败'); }
}

export function resultWord(){ const j=S.jobs.find(x=>x.job_id===S.active); return j&&deliveryViewModel(j,S.arts[S.active]||[]).primary; }

export async function downloadResultWord(){
  const w=resultWord(); if(!w) return;
  let url=w.url||''; if(!url){ const hit=(S.arts[S.active]||[]).find(a=>a.name===w.name); url=hit&&hit.url||''; }
  if(!url){ openJobFolder(); return; }
  try{
    const r=await fetch(/^https?:/i.test(url)?url:net.API+url); if(!r.ok) throw new Error('download');
    const blob=await r.blob(), objectUrl=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=objectUrl; a.download=w.name||'投标文件.docx'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
  }catch(_){ ui.toast('下载失败，已为你打开任务文件夹'); openJobFolder(); }
}

// 右栏产物分组(经典 ART_GROUPS/artGroup/artKind/artPurpose 逐字)
export const ART_GROUPS = [
  {key:0, title:'最终交付 · 先看这里'},
  {key:1, title:'检查报告 · 提交前必看'},
  {key:2, title:'分析依据 · 核对响应'},
  {key:3, title:'过程稿件 · 按需查看'},
];
export function artGroup(n){
  if(/\.(docx|xlsx|pdf)$/i.test(n)) return 0;
  if(/自检|门禁|检查|废标风险|补料清单/.test(n)) return 1;
  if(/响应矩阵|响应对照|偏离表|评分|格式要求|解析版|配图清单|组成/.test(n)) return 2;
  return 3;
}
export function artKind(a){
  if(a.kind) return a.kind;
  const m=(a.name||'').match(/\.([^.]+)$/); return m ? m[1].toUpperCase() : '文件';
}
export function artPurpose(a){
  if(a.purpose) return a.purpose;
  const g=artGroup(a.name||'');
  return g===0?'最终交付文件，请人工复核后提交。':g===1?'检查风险、缺项和格式问题。':g===2?'用于核对招标要求与标书响应。':'生成过程稿件，需要时再查看。';
}
