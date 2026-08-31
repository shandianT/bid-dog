// 更新检查与版本治理:逻辑逐字对应经典 checkForUpdate/applyHealthUpdate/pollHealthUpdate/openUpdate。
// 经典版在这里直接写 #brandVer/#updateLink 的 DOM;迁移后这些由 React 从
// S.updateInfo/S.checkingUpdate/S.engineVersion 渲染,本模块只改状态、只在同样的时机失效。
import { IS_WEB, FORCE_DEMO, BUNDLED_ENGINE_VERSION } from './env.js';
import { S, ui } from './store.js';
import { api } from './gen/api.js';
import { healthUpdateInfo } from './gen/pure.js';
import { presentProblem } from './problems.js';
import { jobState } from './gen/jobs.js';

export function applyHealthUpdate(h){
  const info = healthUpdateInfo(h);
  S.updateInfo = info;
  ui.render('brand');
  // 版本治理:低于最低支持版(required)强提示;过期(expired)持久横幅,主按钮=立即更新。
  const gate = (h && h.version_gate) || {};
  if(gate.mode === 'required' || gate.mode === 'expired'){
    presentProblem({job_id:'_global', level: gate.mode==='expired' ? 'error' : 'warn',
      title: gate.mode==='expired' ? '当前版本已停止支持' : '请尽快更新版本',
      text: gate.message || '请更新到最新版本后继续。已生成的内容与素材库不受影响。',
      actions: [{act:'app_update', label:'立即更新'}, {act:'open_update_page', label:'手动下载'}]});
  }
  return info;
}

// 被动通知不能替代主动查询:版本徽章可点,点它=问一句「我这版还行吗」。
export async function checkForUpdate(){
  if(S.checkingUpdate) return;
  if(S.updateInfo){ ui.openUpdatePanel(); return; }   // 已知有新版:直接进面板,不用再查一遍
  if(!S.online || FORCE_DEMO){ ui.toast('本地服务未连接,连上之后才能检查更新'); return; }
  S.checkingUpdate = true; ui.render('brand');        // 徽章显示「检查中…」
  try{
    const info = applyHealthUpdate(await api('/v1/health'));
    if(info) ui.openUpdatePanel();
    else ui.toast('已经是最新版本 v' + (S.engineVersion || BUNDLED_ENGINE_VERSION));
  }catch(e){
    ui.toast('检查更新失败,请稍后再试');
  }finally{ S.checkingUpdate = false; ui.render('brand'); }  // 查失败也要把版本号还原,不能停在「检查中…」
}

export function runningJobsForUpdate(){
  return (S.jobs||[]).filter(j=>j && ['running','paused'].indexOf(jobState(j))>=0);
}

export async function pollHealthUpdate(attempt){
  if(!S.online || FORCE_DEMO) return;
  try{
    const h = await api('/v1/health');
    if(applyHealthUpdate(h)) return;
    const u = h.update || h.upgrade || h.release_update || {};
    if(['latest','done','error','failed'].indexOf(u.status) >= 0 || h.update_available === false) return;
  }catch(_){ return; }                         // 查更新失败必须静默,不能影响本地任务
  if((attempt||0) < 5) setTimeout(()=>pollHealthUpdate((attempt||0)+1), 1800);
}

export async function openUpdate(){
  const info = S.updateInfo; if(!info) return;
  // 默认 Tauri WebView 没有 new-window handler;桌面端交给本地引擎用系统浏览器打开。
  if(!IS_WEB){
    try{ await api('/v1/open_release', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url:info.url})}); }
    catch(e){ ui.toast('更新页面打开失败，请到 GitHub Releases 下载'); }
    return;
  }
  const a = document.createElement('a');
  a.href = info.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); a.remove();
}
