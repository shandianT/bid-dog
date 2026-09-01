// applyProjectMove 的移植:经典从 el('projectName') 读值,这里由 ProjectSheet 传入;其余逐字。
import { S, ui, api, presentProblem, archivedOnly } from '../core/index.js';

export async function applyProjectMoveWith(nameRaw){
  const name=String(nameRaw||'').trim(),ids=S.projectTargetIds.slice(); if(!name||!ids.length){ui.toast('请填写项目名称');return;}
  let succeeded=[],failed=[];
  for(const id of ids){
    try{await api('/v1/jobs/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:name})});succeeded.push(id);}
    catch(e){failed.push({id,error:e&&e.message||'更新失败'});}
  }
  try{S.jobs=await api('/v1/jobs');if(S.taskScope==='archived'){const r=await api('/v1/jobs?scope=archived');S.archivedJobs=archivedOnly(r);}}catch(_){}
  ui.closeAll();ui.render('tasks');ui.toast('项目更新完成:成功 '+succeeded.length+',失败 '+failed.length);
  if(failed.length)presentProblem({level:'error',title:'部分任务未能归入项目',text:'成功 '+succeeded.length+' 个,失败 '+failed.length+' 个;失败项仍在原项目。',detail:failed.map(x=>x.id+':'+x.error).join('\n'),actions:[{act:'retry_project',label:'重试失败项',param:failed.map(x=>x.id).join(',')}]});
}
