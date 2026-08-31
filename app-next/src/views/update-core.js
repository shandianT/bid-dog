// 应用更新面板的状态与执行:逐字对应经典 openUpdatePanel/runUpdate/renderUpdateSteps/bindUpdateProgress。
// renderUpdateSteps 仍以同名全局暴露(测试座):写状态,渲染交给 UpdateSheet。
import { S, ui, bump, api, runningJobsForUpdate, applyHealthUpdate, openUpdate } from '../core/index.js';
import { IS_WEB, BUNDLED_ENGINE_VERSION } from '../core/env.js';

export const UPDATE_STEPS = [['download','下载安装包'],['install','校验签名并安装'],['restart','重启应用']];
export function fmtMB(bytes){ const n=Number(bytes)||0; return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB'; }

// upd 状态:stage/received/total 驱动三步清单;foot/go/later 驱动按钮区;restart 驱动重启遮罩
export const UPD = { stage:'', received:0, total:0, foot:'', goText:'立即更新', showGo:true, showLater:true, laterText:'稍后再说', restart:false };

export function renderUpdateSteps(stage, received, total){
  UPD.stage = stage; UPD.received = Number(received)||0; UPD.total = Number(total)||0; bump();
}

export function openUpdatePanel(){
  const info = S.updateInfo;
  if(!info){ ui.toast('当前已经是最新版本'); return; }
  if(IS_WEB){ openUpdate(); return; }      // 网页端没有本地安装能力,直接给下载页
  UPD.foot = '更新期间请不要关闭应用。已生成的内容、素材库和设置都不受影响。';
  UPD.goText = runningJobsForUpdate().length ? '仍然更新' : '立即更新';
  UPD.showGo = true; UPD.showLater = true; UPD.laterText = '稍后再说';
  renderUpdateSteps('', 0, 0);
  S.sheet = { name:'update' }; bump();
}

export async function runUpdate(){
  const invoke = typeof window!=='undefined' && window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if(IS_WEB || typeof invoke !== 'function'){ openUpdate(); return; }
  if(S.updating) return;                   // 重复点击 = 并发下载,直接忽略
  S.updating = true;
  UPD.showGo = false; UPD.showLater = false;
  UPD.foot = '正在更新,请不要关闭应用。这一步不能中途取消。';
  renderUpdateSteps('download', 0, 0);
  try{
    const r = await invoke('install_app_update');
    if(r && r.updated === false){         // 已经是最新:面板退回可关闭状态,不假装装过
      S.updating=false; renderUpdateSteps('', 0, 0);
      UPD.foot = r.message||'当前已经是最新版本。';
      UPD.showLater = true; UPD.laterText = '关闭'; bump();
      applyHealthUpdate({});
    }
  }catch(e){
    S.updating=false;
    UPD.foot = (e && (e.message||String(e))) || '自动更新失败。已为你打开下载页,可手动安装。';
    UPD.showGo = true; UPD.goText = '重试'; UPD.showLater = true; bump();
    openUpdate();                          // 自动通道失败退回手动下载,不能把用户困在旧版
  }
}

// Rust 侧把真实的下载字节和阶段播过来(见 emit_update_stage)。收不到也不致命。(经典同注释)
export function showUpdateRestart(v){ UPD.restart = v !== false; bump(); }

export function bindUpdateProgress(){
  const listen = typeof window!=='undefined' && window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen;
  if(typeof listen !== 'function') return;
  listen('app-update://progress', ev => {
    const p = (ev && ev.payload) || {};
    if(p.stage === 'restarting'){ UPD.restart = true; bump(); return; }
    renderUpdateSteps(p.stage === 'installing' ? 'install' : 'download',
                      Number(p.received)||0, Number(p.total)||0);
  }).catch(()=>{});
}
