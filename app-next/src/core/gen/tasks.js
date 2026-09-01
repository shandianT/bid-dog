// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。
// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。
import { net, FORCE_DEMO } from '../env.js';
import { S, ui } from '../store.js';
import { api } from './api.js';
import { presentProblem } from '../problems.js';
import { clearStreamRecovery } from './jobs.js';
import { rerunJob } from './actions.js';

/* ================= 任务列表(事件委托,名字含引号也安全) ================= */
function taskSourceJobs(){return S.taskScope==='archived'?(S.archivedJobs||[]):(S.jobs||[]).filter(j=>!j.archived_at);}
function archivedOnly(result){const list=Array.isArray(result)?result:((result&&result.jobs)||[]);return list.filter(j=>!!j.archived_at);}
function visibleTaskJobs(){
  const project=String(S.projectFilter||'');
  return taskSourceJobs().filter(j=>!project||String(j.project_id||'')===project);
}
async function setTaskScope(scope){
  if(scope!=='active'&&scope!=='archived')return;
  S.taskScope=scope;S.taskSelected.clear();S.taskBulkMode=false;S.taskMore=null;
  if(scope==='archived'&&S.online&&!FORCE_DEMO){
    try{const r=await api('/v1/jobs?scope=archived');S.archivedJobs=archivedOnly(r);}
    catch(e){presentProblem({level:'error',title:'归档列表加载失败',text:'当前任务不受影响，可以重试。',detail:e&&e.message||'',actions:[{act:'reload_archived',label:'重试'}]});}
  }
  ui.render('taskFilters');ui.render('tasks');
}
function setTaskProjectFilter(value){S.projectFilter=String(value||'');S.taskSelected.clear();ui.render('tasks');}
function setTaskBulkMode(enabled){
  if(S.taskBulkDeleting || S.taskBulkBusy) return;
  S.taskBulkMode = !!enabled;
  if(!(S.taskSelected instanceof Set)) S.taskSelected = new Set();
  if(!S.taskBulkMode) S.taskSelected.clear();
  else{
    const current = new Set(visibleTaskJobs().map(j=>j.job_id));
    S.taskSelected.forEach(id=>{ if(!current.has(id)) S.taskSelected.delete(id); });
  }
  ui.render('tasks');
}
function toggleTaskSelection(id, checked){
  if(S.taskBulkDeleting || S.taskBulkBusy) return;
  if(!(S.taskSelected instanceof Set)) S.taskSelected = new Set();
  if(checked) S.taskSelected.add(id); else S.taskSelected.delete(id);
  ui.render('tasks');
}
function toggleAllTaskSelection(){
  if(S.taskBulkDeleting || S.taskBulkBusy) return;
  if(!(S.taskSelected instanceof Set)) S.taskSelected = new Set();
  const ids = visibleTaskJobs().map(j=>j.job_id);
  const all = ids.length > 0 && ids.every(id=>S.taskSelected.has(id));
  if(all) ids.forEach(id=>S.taskSelected.delete(id));
  else ids.forEach(id=>S.taskSelected.add(id));
  ui.render('tasks');
}
async function archiveJob(id){
  if(!id) return;
  try{
    if(FORCE_DEMO || !S.online){ const j=S.jobs.find(x=>x.job_id===id); if(j) j.archived_at=new Date().toISOString(); }
    else await api('/v1/jobs/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:true})});
    if(S.active===id){ clearStreamRecovery(id,true);S.active=null; }
    if(S.online&&!FORCE_DEMO) S.jobs=await api('/v1/jobs');
    S.taskMore=null; ui.render('tasks'); ui.render('main'); ui.toast('已归档，可在项目数据中恢复');
  }catch(e){
    ui.toast('归档失败：'+(e&&e.message||'请重试'));
    presentProblem({level:'error',title:'任务归档失败',text:'任务仍在当前列表，内容没有变化。',detail:e&&e.message||'',actions:[{act:'retry_archive',label:'重试归档',param:id}]});
  }
}
async function restoreJob(id){
  if(!id)return;
  try{
    if(FORCE_DEMO||!S.online){const j=S.archivedJobs.find(x=>x.job_id===id);if(j)j.archived_at=null;S.jobs.push(...S.archivedJobs.filter(x=>x.job_id===id));S.archivedJobs=S.archivedJobs.filter(x=>x.job_id!==id);}
    else{
      await api('/v1/jobs/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:false})});
      const r=await api('/v1/jobs?scope=archived');S.archivedJobs=archivedOnly(r);S.jobs=await api('/v1/jobs');
    }
    if(S.active===id){clearStreamRecovery(id,true);S.active=null;}
    S.taskMore=null;ui.render('tasks');ui.render('main');ui.toast('已恢复到当前任务');
  }catch(e){
    ui.toast('恢复失败：'+(e&&e.message||'请重试'));
    presentProblem({level:'error',title:'任务恢复失败',text:'任务仍保留在归档中。',detail:e&&e.message||'',actions:[{act:'retry_restore',label:'重试恢复',param:id}]});
  }
}
async function exportJobs(ids){
  if(!ids.length) return {succeeded:[],failed:[]};
  S.lastExportIds=ids.slice();
  if(!S.online || FORCE_DEMO){ ui.toast('演示模式不生成真实文件'); return {succeeded:[],failed:ids.slice()}; }
  try{
    const r=await fetch(net.API+'/v1/jobs/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,job_ids:ids})});
    if(!r.ok) throw new Error('导出请求失败');
    const type=r.headers.get('content-type')||'';
    if(/json/i.test(type)){ const data=await r.json(); ui.toast(data.message||(data.path?'导出文件已保存':'导出完成')); return data; }
    const blob=await r.blob(), objectUrl=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=objectUrl;a.download='中标狗_任务导出.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
    ui.toast('导出完成');return {succeeded:ids.slice(),failed:[]};
  }catch(e){
    ui.toast('导出失败：'+(e&&e.message||'请重试'));
    presentProblem({level:'error',title:'任务导出失败',text:'任务内容没有变化，可以直接重试。',detail:e&&e.message||'',actions:[{act:'retry_export',label:'重试导出'}]});
    return {succeeded:[],failed:ids.slice()};
  }
}
async function runBulkTaskAction(action){
  if(S.taskBulkBusy||S.taskBulkDeleting) return;
  const ids=visibleTaskJobs().filter(j=>S.taskSelected.has(j.job_id)).map(j=>j.job_id);
  if(!ids.length){ui.toast('请先选择任务');return;}
  if(action==='project'){ui.openProjectMove(ids);return;}
  if(action==='export'){S.taskBulkBusy=true;ui.render('tasks');try{await exportJobs(ids);}finally{S.taskBulkBusy=false;ui.render('tasks');}return;}
  if(['archive','restore','rerun'].indexOf(action)<0) return;
  S.taskBulkBusy=true;ui.render('tasks');
  let succeeded=[],failed=[];
  try{
    if(FORCE_DEMO||!S.online){
      if(action==='archive'){S.jobs.forEach(j=>{if(ids.indexOf(j.job_id)>=0)j.archived_at=new Date().toISOString();});succeeded=ids.slice();}
      else if(action==='restore'){
        const restored=S.archivedJobs.filter(j=>ids.indexOf(j.job_id)>=0).map(j=>Object.assign({},j,{archived_at:null}));S.jobs.push(...restored);S.archivedJobs=S.archivedJobs.filter(j=>ids.indexOf(j.job_id)<0);succeeded=ids.slice();
      }else failed=ids.map(id=>({id,error:'演示模式暂不支持批量重新生成'}));
    }else{
      const result=(await api('/v1/jobs/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ids,job_ids:ids})}))||{};
      const idOf=x=>typeof x==='string'?x:(x&&String(x.job_id||x.id||''));
      succeeded=(result.succeeded||result.success_ids||[]).map(idOf).filter(Boolean);
      failed=(result.failed||result.failures||[]).map(x=>typeof x==='string'?{id:x,error:'操作失败'}:{id:idOf(x),error:x.error||x.message||'操作失败'});
      const success_count=Number(result.success_count!=null?result.success_count:result.succeeded_count);
      const failure_count=Number(result.failure_count!=null?result.failure_count:result.failed_count);
      if(!succeeded.length&&!failed.length&&result.ok!==false){succeeded=ids.slice();}
      else if(!succeeded.length&&Number.isFinite(success_count)&&success_count>0)succeeded=ids.slice(0,success_count);
      if(!failed.length&&Number.isFinite(failure_count)&&failure_count>0){const okSet=new Set(succeeded);failed=ids.filter(id=>!okSet.has(id)).slice(0,failure_count).map(id=>({id,error:'操作失败'}));}
      S.jobs=await api('/v1/jobs');
      if(S.taskScope==='archived'||action==='archive'||action==='restore'){const r=await api('/v1/jobs?scope=archived');S.archivedJobs=archivedOnly(r);}
    }
    S.taskSelected.clear();failed.forEach(x=>S.taskSelected.add(x.id));S.taskBulkMode=failed.length>0;
    ui.toast('批量操作完成：成功 '+succeeded.length+'，失败 '+failed.length);
    if(failed.length)presentProblem({level:'error',title:'部分任务处理失败',text:'成功 '+succeeded.length+' 个，失败 '+failed.length+' 个；失败项已保留选中。',detail:failed.map(x=>x.id+'：'+x.error).join('\n'),actions:[{act:'diagnose',label:'一键诊断'}]});
  }catch(e){
    failed=ids.map(id=>({id,error:e&&e.message||'请求失败'}));
    ui.toast('批量操作失败：成功 0，失败 '+failed.length);
    presentProblem({level:'error',title:'批量操作没有完成',text:'所选任务没有被统一标记为成功，请检查后重试。',detail:e&&e.message||'',actions:[{act:'diagnose',label:'一键诊断'}]});
  }
  finally{S.taskBulkBusy=false;ui.render('tasks');if(S.active)ui.render('main');}
}
function runTaskRowAction(action,id){
  S.taskMore=null;
  if(action==='archive'){archiveJob(id);return;}
  if(action==='restore'){restoreJob(id);return;}
  if(action==='export'){exportJobs([id]);return;}
  if(action==='project'){ui.openProjectMove([id]);return;}
  if(action==='delete'){delJob(id);return;}
  if(action==='rerun'){
    const old=S.active;S.active=id;rerunJob(true).finally(()=>{if(S.active===id&&old&&old!==id)S.active=old;});
  }
}
async function delJob(id){
  const j = S.jobs.find(x=>x.job_id===id);
  if(!await ui.askConfirm('删除任务「'+((j&&j.name)||id)+'」?', '该任务的招标文件与生成的产出会一并删除,不可恢复;正在生成的会先停止。', true)) return;
  try{
    await api('/v1/jobs/'+encodeURIComponent(id), {method:'DELETE'});
    if(S.active===id){ clearStreamRecovery(id,true);S.active=null;ui.render('main'); }
    S.jobs = await api('/v1/jobs'); ui.render('tasks'); if(S.active) ui.render('rail');
    ui.toast('已删除');
  }catch(e){ ui.toast('删除失败,请重试'); }
}
async function deleteSelectedJobs(){
  if(S.taskBulkDeleting) return;
  if(!(S.taskSelected instanceof Set)) S.taskSelected = new Set();
  const ids = [...new Set(visibleTaskJobs().map(j=>j.job_id).filter(id=>id!=null && S.taskSelected.has(id)))];
  if(!ids.length){ ui.toast('请先选择要删除的任务'); return; }
  S.taskBulkDeleting = true;
  ui.render('tasks');
  let confirmed = false;
  try{ confirmed = await ui.askConfirm('确认批量删除 '+ids.length+' 个任务?', '所选任务的招标文件与生成产出会一并删除,不可恢复;正在生成的会先停止。', true); }
  catch(_){}
  if(!confirmed){ S.taskBulkDeleting = false; ui.render('tasks'); return; }

  const localOnly = FORCE_DEMO || !S.online;
  let succeeded = [], failed = 0, refreshFailed = false;
  try{
    if(localOnly){
      succeeded = ids.slice();
    }else{
      for(const id of ids){
        try{
          const result = await api('/v1/jobs/'+encodeURIComponent(id), {method:'DELETE'});
          if(result && result.ok===false) throw new Error('delete rejected');
          succeeded.push(id);
        }catch(_){ failed += 1; }
      }
    }

    if(succeeded.length){
      const removed = new Set(succeeded);
      S.jobs = S.jobs.filter(j=>!removed.has(j.job_id));
      S.archivedJobs = (S.archivedJobs||[]).filter(j=>!removed.has(j.job_id));
    }
    if(!localOnly){
      try{
        const result = await api(S.taskScope==='archived'?'/v1/jobs?scope=archived':'/v1/jobs');
        const fresh = S.taskScope==='archived'?archivedOnly(result):(Array.isArray(result)?result:(result.jobs||[]));
        const stillThere = new Set(fresh.map(j=>j.job_id));
        const stuck = succeeded.filter(id=>stillThere.has(id));
        if(stuck.length){
          const stuckSet = new Set(stuck);
          succeeded = succeeded.filter(id=>!stuckSet.has(id));
          failed += stuck.length;
        }
        if(S.taskScope==='archived') S.archivedJobs=fresh; else S.jobs = fresh;
      }catch(_){ refreshFailed = true; }
    }

    if(succeeded.includes(S.active)){
      clearStreamRecovery(S.active,true);
      S.active = null;
      ui.render('main');
    }
    S.taskSelected.clear();
    if(failed===0) S.taskBulkMode = false;
  }finally{
    S.taskBulkDeleting = false;
  }
  ui.render('tasks');
  if(S.active) ui.render('rail');
  const note = refreshFailed ? '；列表刷新失败，已按删除结果更新本地列表'
    : (localOnly ? '；演示/断线模式仅更新当前列表' : '');
  ui.toast('批量删除完成：成功 '+succeeded.length+'，失败 '+failed+note);
}


export { taskSourceJobs, archivedOnly, visibleTaskJobs, setTaskScope, setTaskProjectFilter,
  setTaskBulkMode, toggleTaskSelection, toggleAllTaskSelection, archiveJob, restoreJob,
  exportJobs, runBulkTaskAction, runTaskRowAction, delJob, deleteSelectedJobs };
