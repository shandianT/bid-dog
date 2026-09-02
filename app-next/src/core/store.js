// 状态仓库:S 的字段与初始值逐字对应经典前端 1006–1015 行。
// React 侧通过 useSyncExternalStore 订阅 bump();core 里所有「重绘/DOM 触点」都收敛到 ui 适配器。
export const S = { online:false, jobs:[], active:null, msgs:{}, prog:{}, arts:{}, atts:{}, health:{}, chips:{}, worklog:{}, stageAvgs:null, es:null,
          typing:{}, steps:{}, names:{}, paused:{}, answering:{}, openGrp:{0:true, 1:true, 2:false, 3:false},
          taskGrpOpen:{preparing:true, generating:true, needs_input:true, completed:false, failed:false},
          taskBulkMode:false, taskBulkDeleting:false, taskBulkBusy:false, taskBulkMore:false, taskSelected:new Set(), taskMore:null,
          taskScope:'active', archivedJobs:[], projectFilter:'', processView:{}, problems:{}, diagnostic:null, projectTargetIds:[], templates:[], setup:null, onboardingStep:1,
          midTab:{}, pipeline:{}, coverage:{}, p0RefreshAt:{}, pvPref:'word',
          artsLoaded:{}, eventTimes:{}, esOffsets:{}, wordNotified:{}, streamState:{}, reconnectTimers:{}, pollTimers:{}, recoveredTimers:{},
          updateInfo:null, updating:false, engineVersion:'', rerunBusy:{}, rerunKeys:{}, nodeRetryBusy:{}, nodeRetryKeys:{}, flowPhaseSelection:{} };

// ——迁移新增字段:经典版直接写 DOM 的几处文本/颜色,这里改为状态,由 React 渲染——
// connText ← el('conn').textContent;demoTag ← #demoTag(null=隐藏);brandDot ← 'ok'|'warn';
// heroSub ← #heroSub;sbR ← #sbR;toastMsg ← #toast;checkingUpdate ← 版本徽章「检查中…」。
Object.assign(S, { connText:'', demoTag:null, brandDot:'warn', heroSub:'', sbR:'',
                   toastMsg:null, checkingUpdate:false, engineOffline:false, stale:null, flowOpen:{}, railFold:{} });

let version = 0;
const listeners = new Set();
export function bump(){ version++; listeners.forEach(f => { try{ f(); }catch(_){} }); }
export function getVersion(){ return version; }
export function subscribe(f){ listeners.add(f); return () => listeners.delete(f); }

// ui 适配器:core 只声明「发生了什么」,呈现由 React 侧接管。默认实现保证 core 可以无 DOM 运行。
// 每个键都能对应回经典源码的一处 DOM 触点(见 tools/extract-core.mjs 的替换表)。
export const ui = {
  render(_area){ bump(); },                       // renderXxx() → 全量失效,React 自己 diff
  conn(text){ S.connText = String(text); bump(); }, // el('conn').textContent = …
  toast(t){ S.toastMsg = { text:String(t), at:Date.now() }; bump(); }, // toast(t)
  notify(t){ // notify(t):系统通知,仅网页版且已授权(与经典一致)
    try{
      if(typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification('中标狗', { body:String(t).slice(0,80) });
    }catch(_){}
  },
  answerMode(on){   // answerMode(on):切换输入框到「回答 agent 提问」通道。
    // 语义与经典逐字一致:存的是当前提问的 qid(send() 靠它判断走 /answers 还是 /messages),
    // 不是布尔值。视图迁移 C 落地时由聊天组件覆写,补上占位文案与焦点行为。
    const id = S.active; if(!id) return;
    S.answering[id] = on ? (S.chips[id]||{}).qid : null;
    bump();
  },
  openUpdatePanel(){ S.updSheetOpen = true; bump(); }, // openUpdatePanel():视图 D 覆写成真弹层
  showOnboarding(_force){},                        // showOnboarding(force):视图 D 覆写
};

// 尚未被视图接管的弹层/确认钩子:默认实现保证 core 在无头环境不炸,
// 但确认类一律返回「不确认」——宁可动作不执行,不能替用户点「删除」。
const pendingHook = name => (...args) => { console.warn('[ui] ' + name + ' 尚未由视图接管', args); };
Object.assign(ui, {
  askConfirm: async (...args) => { console.warn('[ui] askConfirm 尚未由视图接管,按「取消」处理', args); return false; },
  openProjectMove: pendingHook('openProjectMove'), closeAll: pendingHook('closeAll'),
  showDiagnosticDetail: pendingHook('showDiagnosticDetail'), runDiagnostics: pendingHook('runDiagnostics'),
  openRevision: pendingHook('openRevision'), downloadDiagnosticBundle: pendingHook('downloadDiagnosticBundle'),
  openSheet: pendingHook('openSheet'), openLog: pendingHook('openLog'), openRedo: pendingHook('openRedo'),
  openCheck: pendingHook('openCheck'), repairJob: pendingHook('repairJob'),
  openArtifact: pendingHook('openArtifact'), openJobFolder: pendingHook('openJobFolder'),
});
