// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。
// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。
import { ASK_SELF } from '../env.js';
import { S, ui } from '../store.js';
import { api } from './api.js';
import { presentProblem } from '../problems.js';
import { taskCapabilities, _friendlyText } from './pure.js';
import { select, loadJobs, refreshArts } from './jobs.js';
import { openUpdate } from '../update.js';

async function resumeJob(){
  if(!S.active || !S.online){ ui.toast('本地服务未连接'); return; }
  try{
    const r = await api('/v1/jobs/'+S.active+'/resume',{method:'POST'});
    if(r && r.ok===false){ ui.toast(r.error || '接不上原来的会话'); return; }
    S.paused[S.active] = false; ui.toast('接着上次的地方继续');
    delete S.problems[S.active]; ui.render('problem'); ui.render('head');
    loadJobs();
  }catch(e){ ui.toast((e && e.message) || '续做失败,请看运行日志'); }
}
async function togglePause(){
  if(!S.active || !S.online) return;
  const job=S.jobs.find(j=>j.job_id===S.active),caps=taskCapabilities(job||{});
  if(!caps.pause){ui.toast(caps.pauseReason);return;}
  if(S.paused[S.active]) return resumeJob();
  try{
    const r = await api('/v1/jobs/'+S.active+'/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});
    /* 暂停不一定成得了(兼容模式没有可中断的会话)。后端说没成就别把界面画成已暂停,
       否则又是一次「界面说停了、它还在写」。 */
    if(r && r.ok===false){ ui.toast(r.error || '当前这轮停不下来'); return; }
    S.paused[S.active] = true; ui.render('head');
  }catch(e){ ui.toast((e && e.message) || '操作失败'); }
}
async function stopJob(){
  if(!S.active || !await ui.askConfirm('停止这个任务?', '会终止正在进行的生成；已生成的文件全部保留，之后可以重新生成或继续修改。', true)) return;
  try{ await api('/v1/jobs/'+S.active+'/stop', {method:'POST'}); ui.toast('已停止'); }
  catch(e){ui.toast('停止失败，请重试');presentProblem({level:'error',title:'任务停止失败',text:'任务状态没有被标记为已停止，请先确认当前进度。',detail:e&&e.message||'',actions:[{act:'retry_stop',label:'重试停止'}]});}
}
async function rerunJob(skipAsk){
  if(!S.active) return;
  const sourceId=S.active;
  if(S.rerunBusy[sourceId])return;
  if(!skipAsk && !await ui.askConfirm('重新生成一个任务?', '用同一份招标文件从头生成新任务；当前任务和文件都会保留。')) return;
  S.rerunBusy[sourceId]=true;
  const actionKey=S.rerunKeys[sourceId]||('rerun-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  S.rerunKeys[sourceId]=actionKey;
  try{
    const r = await api('/v1/jobs/'+sourceId+'/rerun',{method:'POST',headers:{'Idempotency-Key':actionKey}});
    delete S.rerunKeys[sourceId];
    S.jobs = await api('/v1/jobs'); ui.toast(r.deduplicated?'已恢复刚才的重新生成任务':'已开始重新生成'); select(r.job_id);
  }catch(e){ ui.toast('重新生成失败：原任务的招标文件可能已不在'); }
  finally{delete S.rerunBusy[sourceId];}
}
async function errAction(act, file, param){
  /* 消息里的操作按钮:报错自救 + 对话指挥任务(重启/定向重做),点了才执行 */
  if(act==='show_detail'){ ui.showDiagnosticDetail(param||S.diagnostic||((S.problems[S.active||'_global']||S.problems._global||{}).detail)||'暂无更多技术信息'); return; }
  if(act==='diagnose'){ ui.runDiagnostics(); return; }
  if(act==='app_update'){ ui.openUpdatePanel(); return; }
  if(act==='open_update_page'){ openUpdate(); return; }
  if(act==='continue_saved'||act==='open_revision'){ ui.openRevision(); return; }
  if(act==='bundle'){ ui.downloadDiagnosticBundle(); return; }
  if(act==='open_engine'){ ui.openSheet('providers'); return; }
  if(act==='open_log'){ ui.openLog(); return; }
  if(act==='rerun'){ rerunJob(true); return; }
  if(act==='redo'){
    if(!S.active || !S.online) return;
    try{
      const r = await api('/v1/jobs/'+S.active+'/redo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instruction: param||''})});
      ui.toast(r.ok ? '新版本已开始生成，进度看右侧' : ('无法修改：'+(r.error||'')));
    }catch(e){ ui.toast('修改没有启动：任务可能正在运行'); }
    return;
  }
  if(act==='resume'){ resumeJob(); return; }
  if(act==='retry_node'){
    if(!S.active || !S.online || !param) return;
    const retryOp=S.active+':'+param;
    if(S.nodeRetryBusy[retryOp]) return;
    S.nodeRetryBusy[retryOp]=true;
    try{
      const retryKey=S.nodeRetryKeys[retryOp]||(S.nodeRetryKeys[retryOp]=(globalThis.crypto&&globalThis.crypto.randomUUID?globalThis.crypto.randomUUID():('retry-'+Date.now()+'-'+Math.random().toString(36).slice(2))));
      const r=await api('/v1/jobs/'+encodeURIComponent(S.active)+'/nodes/'+encodeURIComponent(param)+'/retry',{
        method:'POST',headers:{'Idempotency-Key':retryKey}});
      if(r.ok) delete S.nodeRetryKeys[retryOp];
      if(r.ok && r.pending){ ui.toast(r.message||'这一节点的重试已经在跑了，稍等看进度即可'); }
      else ui.toast(r.ok ? '正在重试当前节点，已完成内容不会重写' : ('重试没有启动：'+(r.error||'')));
      if(r.ok){ delete S.problems[S.active]; ui.render('problem'); }
      await loadJobs();
    }catch(e){
      // 后端明确确认“未派发”时才换新的操作键；网络超时的结果未知，必须
      // 保留原键，避免用户再次点击导致同一节点重复运行。
      if(e&&e.code==='retry_dispatch_failed') delete S.nodeRetryKeys[retryOp];
      ui.toast('重试没有启动：'+(e&&e.message||'请查看诊断详情'));
    }
    finally{ S.nodeRetryBusy[retryOp]=false; }
    return;
  }
  if(act==='open_redo'){ ui.openRedo(); return; }
  if(act==='repair'){ ui.openCheck(); ui.repairJob(); return; }
  if(act==='open_artifact'){ ui.openArtifact(file); return; }
  if(act==='open_job_folder'){ ui.openJobFolder(); return; }
  if(act==='export_docx'){
    /* 跑完没出 Word 时的自救:引擎拿正文稿跑确定性导出脚本,不重跑、不花额度 */
    if(!S.active || !S.online){ ui.toast('本地服务未连接'); return; }
    ui.toast('正在导出 Word…');
    try{
      const r = await api('/v1/jobs/'+S.active+'/export_docx',{method:'POST'});
      if(r.ok && r.made && r.made.length){
        ui.toast('已补出:'+r.made.join('、'));
        await refreshArts(S.active); ui.render('head'); ui.render('rail'); ui.openArtifact(r.made[0]);
      }
      else ui.toast(r.error || '没有可导出的正文稿');
    }catch(e){ ui.toast('导出失败:'+(e && e.message ? e.message : '请查看运行日志')); }
    return;
  }
  if(act==='mock_rerun'){
    if(!S.active || !S.online) return;
    try{
      await api('/v1/agent',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'mock', mode:'agents'})});
      ui.toast('已切到内置演示，开始重新生成');
      rerunJob(true);
    }catch(e){ ui.toast('切换失败,请到「设置 · 模型接入」手动选择'); }
    return;
  }
  /* 兜底:引擎发来一个前端不认识的动作。以前这里直接走到函数末尾静默 return——
     「定向重做不达标章节」(open_redo)就这么死了很久:按钮画得好好的,点了毫无反应。
     宁可当面说"这版应用不认识这个动作",也不让用户对着一颗死按钮猜。 */
  ui.toast('这版应用还不认识「'+act+'」这个操作,可能是引擎比应用新。请更新应用后重试。');
  console.warn('[errAction] 未处理的动作:', act, {file, param});
}

async function say(text){
  if(!S.active){ ui.toast('先拖一份招标文件建任务,我们再聊'); return; }
  const id = S.active;
  if(S.online){
    const list = (S.msgs[id]=S.msgs[id]||[]);
    const m = {role:'user', text, _local:1};
    list.push(m); S.typing[id] = true; ui.render('chat');          // 立刻回显 + "正在回复…",不再石沉大海
    clearTimeout(S._typT);
    S._typT = setTimeout(()=>{ if(S.typing[id]){ S.typing[id]=false; if(S.active===id) ui.render('chat'); } }, 90000);
    try{ await api('/v1/jobs/'+id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'text',content:text})}); }
    catch(e){ m._fail = 1; S.typing[id] = false; if(S.active===id) ui.render('chat'); ui.toast('发送失败：没连上本地服务'); }
  }
  else { addLocal('user',text); setTimeout(()=>addLocal('agent','(演示)收到:「'+text+'」。已纳入当前章节,继续推进。'),500); }
}
async function answer(choice){
  if(choice === ASK_SELF){ ui.answerMode(true); return; }      // 切通道,不是交答案
  const id = S.active, q = S.chips[id];
  if(S.online){
    (S.msgs[id]=S.msgs[id]||[]).push({role:'user', text:choice, _local:1}); ui.render('chat');
    try{
      const result=await api('/v1/jobs/'+id+'/answers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question_id:q&&q.qid,choice})});
      if(result&&result.ok===false)throw new Error(result.error||'答案未送达');
      S.chips[id]=null;ui.answerMode(false);
    }
    catch(e){
      S.chips[id]=q;
      if(q&&S.active===id)ui.answerMode(true);
      ui.toast('答案未送达，问题已保留，可以直接重试');
    }
  }
  else { S.chips[id]=null;ui.answerMode(false);addLocal('user',choice); setTimeout(()=>addLocal('agent','(演示)好,按「'+choice+'」处理,继续。'),500); }
  ui.render('chat');
}
function addLocal(role,text){ (S.msgs[S.active||'demo']=S.msgs[S.active||'demo']||[]).push({role,text}); ui.render('chat'); }

export { resumeJob, togglePause, stopJob, rerunJob, errAction, say, answer, addLocal };
