// 连接引导:findEngine 逐字对应经典;goOnline/showEngineOffline/boot 的全部文案与时序保留,
// 仅把 DOM 写入换成 S 字段(connText/demoTag/brandDot/sbR/heroSub 的映射见 store.js 注释)。
import { IS_WEB, IS_SOURCE_PREVIEW, FORCE_DEMO, BUNDLED_ENGINE_VERSION, API_CANDIDATES,
         NEED_FEATURES, isWin, net } from './env.js';
import { S, ui } from './store.js';
import { api } from './gen/api.js';
import { select } from './gen/jobs.js';
import { applyHealthUpdate, pollHealthUpdate } from './update.js';
import { presentProblem } from './problems.js';

export async function findEngine(){
  let stale = null;
  for(const base of API_CANDIDATES){
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(), 900);
    try{
      const r = await fetch(base + '/v1/health', {cache:'no-store',signal:controller.signal});
      if(!r.ok) continue;
      const h = await r.json();
      const feats = h.features || [];
      const rightVersion = IS_WEB || h.version === BUNDLED_ENGINE_VERSION;
      if(rightVersion && NEED_FEATURES.every(f => feats.indexOf(f) >= 0)){ net.API = base; S.stale = null; return h; }
      stale = stale || {base, h};
    }catch(e){}
    finally{clearTimeout(timer);}
  }
  if(stale) S.stale = stale.h.version || '旧版';
  return null;
}

export async function goOnline(h){
  S.online = true; S.engineOffline = false; S.engineVersion = h.version||'?';
  ui.conn('本地服务已连接'); S.demoTag = null;
  S.heroSub = '把招标文件交给我,预检 → 分析 → 分章撰写 → 出 Word,全程可对话';
  S.brandDot = 'ok';
  if(S.stale){
    ui.conn('本地服务需要更新');
    S.brandDot = 'warn';
    S.demoTag = '检测到旧版引擎占用端口 · 请退出旧版应用/旧引擎进程后重开本应用';
  }
  S.sbR = h.data_dir + (isWin?'\\jobs':'/jobs');
  applyHealthUpdate(h); setTimeout(()=>pollHealthUpdate(0), 1200);
  S.jobs = await api('/v1/jobs');
  const firstJob=S.jobs.find(j=>!j.archived_at);if(firstJob){ select(firstJob.job_id); }
  // 经典版直接 setInterval;这里存句柄防止「离线→重连」时叠加出第二个轮询。
  if(S._jobsRefreshTimer) clearInterval(S._jobsRefreshTimer);
  S._jobsRefreshTimer = setInterval(async()=>{ try{
    const demos=(S.jobs||[]).filter(j=>String(j.job_id).startsWith('demo'));   // 本地演示任务不在服务端,轮询覆盖时要保住
    S.jobs = demos.concat(await api('/v1/jobs'));
    ui.render('tasks'); if(S.active){ ui.render('head'); ui.render('rail'); ui.render('main'); } }catch(e){} }, 4000);
  try{ const st = await api('/v1/stats/stages'); S.stageAvgs = st.stages || null; }catch(e){}
  ui.render('tasks'); ui.render('main'); ui.showOnboarding(false);
}

export function showEngineOffline(){
  S.online = false; S.engineOffline = true;
  ui.conn(IS_SOURCE_PREVIEW ? '源码预览（未连接引擎）' : (S.stale ? '本地服务需要更新' : '本地引擎未启动'));
  S.demoTag = IS_SOURCE_PREVIEW
    ? '源码预览不能启动内置引擎'
    : S.stale
    ? '检测到旧版引擎 · 正在安全切换到新版'
    : '本地引擎未启动 · 当前无法生成真实文件';
  S.brandDot = 'warn';
  S.sbR = isWin ? 'C:\\Users\\me\\Documents\\中标狗\\jobs' : '~/Documents/中标狗/jobs';
  S.heroSub = IS_SOURCE_PREVIEW
    ? '当前打开的是源码预览；请从“应用程序”启动中标狗桌面端'
    : S.stale
    ? '旧引擎若还有任务会先安全收尾；完成后应用会自动连接新版，无需手动关进程'
    : '生成环境没有启动；应用会继续重连，也可以立即运行诊断查看缺失组件和启动路径';
  ui.render('tasks'); ui.render('main');
  presentProblem({
    job_id:'_global',
    level:'error',
    title:IS_SOURCE_PREVIEW ? '当前打开的是源码预览' : (S.stale ? '本地生成引擎需要更新' : '本地生成引擎没有启动'),
    text:IS_SOURCE_PREVIEW
      ? '此页面只能预览界面，不具备启动或修复内置引擎的桌面权限。'
      : S.stale
      ? '已验证为中标狗旧引擎，正在安全收尾并自动切换；不会强制中断仍在生成的任务。'
      : '安装包内置引擎没有成功启动，可能是安装不完整、被安全软件隔离，或启动路径不可用。',
    detail:IS_SOURCE_PREVIEW ? '请关闭 index.html 预览页，双击“/应用程序/中标狗.app”。' : '桌面端会校验内置引擎身份，重启已确认属于本应用的无响应进程，并将结果写入 engine-bootstrap.log。',
    actions:[{act:'diagnose',label:IS_SOURCE_PREVIEW?'查看打开方法':'检查并修复'}]
  });
}

export async function boot(){
  ui.render('brand');   // 先把版本号亮出来,不等引擎——引擎连不上时更需要它
  if(FORCE_DEMO){
    S.online = false;
    ui.conn('在线体验版(演示数据)');
    S.demoTag = '在线体验版 · 流程与交互完全真实,产出为样例;下载桌面版接入你自己的模型即可产真实标书';
    S.brandDot = 'warn';
    S.sbR = '在线体验 · 不上传任何文件';
    S.heroSub = '在线体验版:拖入任意文件即可完整走一遍 12 阶段流程(不会上传,不会真跑模型)';
    ui.render('tasks'); ui.render('main');
    return;
  }
  for(let i=0;i<4;i++){
    const h = await findEngine();
    if(h) return goOnline(h);
    ui.conn('正在启动本地服务…');
    await new Promise(r=>setTimeout(r,2000));
  }
  showEngineOffline();
  const re = setInterval(async()=>{
    const h = await findEngine();
    if(h){
      clearInterval(re);
      delete S.problems._global; ui.render('problem');
      await goOnline(h);                         // 原地接管,不刷新丢掉用户尚未提交的 Key
    }
  }, 5000);
}
