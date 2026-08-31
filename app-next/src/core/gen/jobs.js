// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。
// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。
import { net, IS_WEB } from '../env.js';
import { S, ui } from '../store.js';
import { api } from './api.js';
import { presentProblem } from '../problems.js';
import { _friendlyText, friendlyRuntimeNotice, withDiagnosticAction, isBodyWordArtifact,
         wordPresence, nextStreamState, streamReconnectDelay, eventStreamUrl, activeClock } from './pure.js';

async function loadPipeline(id){
  if(!S.online||!id)return;
  try{S.pipeline[id]=await api('/v1/jobs/'+id+'/pipeline');}
  catch(_){S.pipeline[id]=null;}
  if(S.active===id)ui.render('p0');
}
async function loadCoverage(id){
  if(!S.online||!id)return;
  try{S.coverage[id]=await api('/v1/jobs/'+id+'/coverage');}
  catch(_){S.coverage[id]=null;}
  if(S.active===id)ui.render('covpill');
}
function maybeRefreshP0(id,e){
  if(!e||['progress','question','question_closed','error','message'].indexOf(e.type)<0)return;
  const at=S.p0RefreshAt[id]||0;
  if(Date.now()-at<4000)return;
  S.p0RefreshAt[id]=Date.now();
  loadPipeline(id);loadCoverage(id);
}
function covReasonHint(item){
  const x=item||{};
  const reason=String(x.reason||'')||(x.location&&String(x.location).indexOf('需补充')<0?'chapter_pending':'unlocated');
  if(reason==='gap') return '规划里还留着缺口,补齐后自动计入';
  if(reason==='chapter_pending') return '所在章节还没写完,写完自动计入';
  return '还没落到具体章节,可在「对话与要求」里补要求';
}
/* ================= 选择任务 + SSE(断线自动重连) ================= */
function stopJobPolling(id){
  if(S.pollTimers[id]){clearInterval(S.pollTimers[id]);delete S.pollTimers[id];}
}
async function loadJobs(){
  /* 重试/续做成功后的状态刷新。此前这个函数从未被定义,retry_node 成功路径
     `await loadJobs()` 直接抛 ReferenceError 被 catch 吃掉,把刚弹的成功提示
     覆盖成「重试没有启动:loadJobs is not defined」——反馈 9「点了重试没反应、
     只能重新开始」的直接前端根源。 */
  try{
    const demos=(S.jobs||[]).filter(j=>String(j.job_id).startsWith('demo'));
    S.jobs = demos.concat(await api('/v1/jobs'));
  }catch(e){ return; }
  ui.render('tasks'); if(S.active){ ui.render('head'); ui.render('rail'); ui.render('main'); }
}
async function pollJobState(id){
  if(!S.online||S.active!==id)return;
  try{
    S.jobs=await api('/v1/jobs');
    if(S.active===id){ui.render('tasks');ui.render('head');ui.render('rail');ui.render('main');}
  }catch(_){/* 本轮失败保持已有任务事实；下一轮继续 */}
}
function startJobPolling(id){
  if(!S.online||S.active!==id||S.pollTimers[id])return;
  pollJobState(id);S.pollTimers[id]=setInterval(()=>pollJobState(id),4000);
}
function clearStreamRecovery(id,closeSource){
  if(S.reconnectTimers[id]){clearTimeout(S.reconnectTimers[id]);delete S.reconnectTimers[id];}
  if(S.recoveredTimers[id]){clearTimeout(S.recoveredTimers[id]);delete S.recoveredTimers[id];}
  stopJobPolling(id);
  if(closeSource&&S.es){S.es.close();S.es=null;}
}
function resetStreamReplayState(id){
  S.esOffsets[id]=0;S.msgs[id]=[];S.chips[id]=null;S.worklog[id]=[];
  S.eventTimes[id]=[];S.steps[id]={};S.names[id]={};
}
function markStreamOpen(id){
  const old=S.streamState[id]||{mode:'idle',failures:0};
  S.streamState[id]=nextStreamState(old,'open');
  if(S.reconnectTimers[id]){clearTimeout(S.reconnectTimers[id]);delete S.reconnectTimers[id];}
  stopJobPolling(id);ui.render('flow');
  if(S.streamState[id].mode==='recovered'){
    if(S.recoveredTimers[id])clearTimeout(S.recoveredTimers[id]);
    S.recoveredTimers[id]=setTimeout(()=>{
      if(S.active===id){S.streamState[id]=nextStreamState(S.streamState[id],'settled');ui.render('flow');}
      delete S.recoveredTimers[id];
    },3000);
  }
}
function recordStreamFailure(id){
  S.streamState[id]=nextStreamState(S.streamState[id],'error');
  const state=S.streamState[id];
  if(state.mode==='polling')startJobPolling(id);
  if(S.reconnectTimers[id])clearTimeout(S.reconnectTimers[id]);
  if(S.active===id&&S.online){
    S.reconnectTimers[id]=setTimeout(()=>{
      delete S.reconnectTimers[id];
      if(S.active===id&&S.online&&!S.es)attachES(id,true);
    },streamReconnectDelay(state.failures));
  }
  ui.render('flow');
  return state;
}
function select(id){
  const previous=S.active;if(previous&&previous!==id)clearStreamRecovery(previous,true);
  if(S.esOffsets[id] == null){
    S.esOffsets[id] = 0; S.msgs[id] = []; S.chips[id] = null;
    S.worklog[id] = []; S.eventTimes[id] = []; S.steps[id] = {}; S.names[id] = {};
  }
  if(S.processView[id]==null) S.processView[id]=false;
  S.active = id; ui.render('main'); ui.render('tasks'); ui.render('chat'); ui.render('head'); ui.render('rail'); loadAtts(id);
  if(S.online){
    attachES(id, false);
    refreshArts(id).then(()=>{ if(S.active===id){ ui.render('head'); ui.render('rail'); ui.render('tasks'); ui.render('main'); } });
    loadPipeline(id); loadCoverage(id);
  }
}
export function installVisibilityHandler(){
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState !== 'visible' || !S.online) return;
    api('/v1/jobs').then(j=>{ S.jobs=j; ui.render('tasks'); ui.render('head'); ui.render('main'); }).catch(()=>{});
    if(S.active && (!S.es || S.es.readyState === 2)) attachES(S.active, true);   // 流被浏览器挂起就续传
  });
}

function attachES(id, reconnecting){
  if(S.es) S.es.close();
  if(S.reconnectTimers[id]){clearTimeout(S.reconnectTimers[id]);delete S.reconnectTimers[id];}
  const offset = Math.max(0, Number(S.esOffsets[id])||0);
  const es = new EventSource(eventStreamUrl(net.API, id, offset)); S.es = es;
  es.onopen = () => {
    if(S.es === es && S.active === id){
      markStreamOpen(id);
      ui.conn('本地服务已连接');
    }
  };
  es.onmessage = ev => {
    if(S.es !== es) return;
    const stream=S.streamState[id]||(S.streamState[id]={mode:'connected',failures:0});stream.lastEventAt=Date.now();
    try{
      const parsed=JSON.parse(ev.data);
      if(parsed&&parsed.type==='stream_reset'){
        resetStreamReplayState(id);
        es.close();if(S.es===es)S.es=null;
        if(S.active===id){ui.render('chat');ui.render('worklog');setTimeout(()=>attachES(id,true),0);}
        return;
      }
      const cursor=Number(parsed&&parsed._cursor)||Number(ev.lastEventId)||0;
      S.esOffsets[id]=Math.max(Number(S.esOffsets[id])||0,cursor);
      handle(id,parsed);
    }catch(e){ console.warn('[events] 忽略坏事件', e); }
  };
  es.onerror = () => {           // 引擎重启/网络抖动:3 秒后自动重连,不再停在假死页面
    es.close();
    if(S.es === es){
      S.es = null; S.typing[id] = false;
      if(S.active===id) ui.conn('连接暂时中断 · 正在自动继续');
      recordStreamFailure(id);
    }
  };
}
function eventIsRecent(e){ const t=ts2ms(e&&e.ts); return !!t && Math.abs(Date.now()-t) < 30000; }
function handle(id, e){
  const rawEventText=String((e&&e.text)||'');
  const runtimeNotice=friendlyRuntimeNotice(e);
  if(e && e.type==='message' && runtimeNotice.text && runtimeNotice.text!==rawEventText){
    e=Object.assign({},e,{text:runtimeNotice.text,actions:(e.actions||[]).concat([runtimeNotice.action])});
    if(runtimeNotice.technicalDetail){
      S.diagnostic=runtimeNotice.technicalDetail;
      if(runtimeNotice.text.startsWith('主连接响应较慢，已切换稳定通道继续'))
        presentProblem({job_id:id,level:'info',title:'已自动保持任务继续',text:runtimeNotice.text,detail:runtimeNotice.technicalDetail,
          actions:[{act:'show_detail',label:'查看原因'},{act:'diagnose',label:'一键诊断'}]});
    }
  }
  const etm = ts2ms(e&&e.ts);
  if(etm){
    const times = (S.eventTimes[id]=S.eventTimes[id]||[]);
    if(times.indexOf(etm)<0){ times.push(etm); times.sort((a,b)=>a-b); }
  }
  if(S.active===id && eventIsRecent(e)) maybeRefreshP0(id,e);   // 大纲/覆盖仪表跟着真实事件走,历史回放不刷
  if(e.type==='message'){
    const list = (S.msgs[id]=S.msgs[id]||[]);
    if(e.role==='user'){
      const i = list.findIndex(x=>x._local && !x._fail && x.text===e.text);   // 服务端回声与本地即显合并,不出双气泡
      if(i>=0) list[i] = {role:'user', text:e.text}; else list.push(e);
    } else {
      const shown=Object.assign({},e,{text:_friendlyText(e.text)});
      list.push(shown); S.typing[id] = false;
      if(e.role==='agent' && eventIsRecent(e)) ui.notify(shown.text);
    }
  }
  if(e.type==='worklog'){
    const wl = (S.worklog[id]=S.worklog[id]||[]);
    for(const ln of (e.lines||[])) wl.push(_friendlyText(ln));
    if(wl.length > 400) wl.splice(0, wl.length - 400);
    if(S.active===id) ui.render('worklog');
  }
  if(e.type==='status'){ S.typing[id] = e.state==='thinking' && (Date.now()-ts2ms(e.ts) < 120000); }
  if(e.type==='question_closed'){ const q = S.chips[id];
    if(q && (!e.id || q.qid===e.id)){ S.chips[id] = null; const jj=S.jobs.find(x=>x.job_id===id);if(jj)jj.needs_attention=false;if(S.active===id) ui.answerMode(false); } }
  if(e.type==='progress'){
    const stage=_friendlyText(e.stage);
    S.prog[id]=Object.assign({},e,{stage});
    // 任务真的在往前走:清掉这单挂着的旧错误横幅(自动恢复成功后横幅不该一直赖着)
    if(eventIsRecent(e) && !e.terminal && S.problems[id]){ delete S.problems[id]; ui.render('problem'); }
    const jj=S.jobs.find(x=>x.job_id===id);
    // 重连时 SSE 会把这一单的历史事件整段回放。回放里的每条 progress 都曾把
    // 「已停止」改写成「运行中」——服务端说停了,界面却自己判它在跑,于是倒计时继续走、
    // 「从断点继续」被当成不需要。只有确实新鲜的事件才有资格改状态,历史只补进度数字。
    const live=eventIsRecent(e);
    if(jj){jj.pct=e.pct;jj.stage=stage;jj.current_action=stage;
      if(live)jj.last_activity_at=e.ts||new Date().toISOString();
      if(Number(e.pct)>=100)jj.state='done';
      else if(live&&(!jj.state||['done','stopped','unknown'].indexOf(jj.state)>=0))jj.state='running';}
    const k = e.step||0;
    if(k){
      const st = (S.steps[id]=S.steps[id]||{});
      if(!st[k]){
        (S.msgs[id]=S.msgs[id]||[]).push({role:'sys', text:'第 '+k+'/'+(e.total||12)+' 步 · '+stage});
        st[k] = ts2ms(e.ts) || Date.now();
      } else if(ts2ms(e.ts)) st[k] = Math.min(st[k], ts2ms(e.ts));
      (S.names[id]=S.names[id]||{})[k] = stage;
      const wl = (S.worklog[id]=S.worklog[id]||[]);
      const dv = '── 第 '+k+' 步 · '+stage+' ──';
      if(wl[wl.length-1] !== dv) wl.push(dv);
    }
  }
  if(e.type==='question'){
    const question=_friendlyText(e.text);
    S.chips[id]={qid:e.id, options:e.options||[], text:question, kind:e.kind||'', payload:e.payload||null};
    const jj=S.jobs.find(x=>x.job_id===id);if(jj)jj.needs_attention=true;
    (S.msgs[id]=S.msgs[id]||[]).push({role:'agent',text:question});
    // 开放式提问(agent 没给选项):直接把输入框切到回答通道 ——
    // 不然界面上一个可点的东西都没有,而 agent 就在那边等着,谁也不知道该干什么
    if(S.active===id && !(e.options||[]).length) ui.answerMode(true);
  }
  if(e.type==='artifact'){
    const list = (S.arts[id]=S.arts[id]||[]);
    if(!list.some(a=>a.name===e.name)) list.push(e);
    const recentBodyWord = isBodyWordArtifact(e) && eventIsRecent(e);
    if(isBodyWordArtifact(e)){const jj=S.jobs.find(x=>x.job_id===id);if(jj)jj.has_word=true;}
    refreshArts(id).then(()=>{
      if(recentBodyWord && wordPresence(S.arts[id], S.artsLoaded[id]) === 'ready' && !S.wordNotified[id]){
        S.wordNotified[id] = true; ui.notify('已出 Word · 待你确认');
      }
      if(id===S.active){ ui.render('head'); ui.render('rail'); ui.render('tasks'); }
    });
  }
  if(e.type==='health'){
    S.health[id]=Object.assign({},e,{summary:_friendlyText(e.summary),gaps:(e.gaps||[]).map(g=>Object.assign({},g,{title:_friendlyText(g.title),detail:_friendlyText(g.detail)}))});
  }
  if(e.type==='error'){
    const friendly=friendlyRuntimeNotice(e), visible=friendly.text||'任务遇到问题，已有内容已保存。';
    const actions=withDiagnosticAction(e.actions);
    (S.msgs[id]=S.msgs[id]||[]).push({role:'agent', text:'⚠ '+visible, actions});
    // 只有「新鲜的」错误才弹红色横幅。事件流每次打开任务都会从头回放,
    // 历史上已被自动重试消化掉的失败若无条件弹横幅,好端端在跑/已完成的任务
    // 也会顶着「任务没有按预期继续」——中间文件明明完好(真机反馈 6 的主因之一)。
    const jj=S.jobs.find(x=>x.job_id===id);
    const stateNow=jj&&(jj.state||'');
    if(eventIsRecent(e) && stateNow!=='running' && stateNow!=='done'){
      presentProblem({job_id:id,level:'error',title:'任务没有按预期继续',text:visible,
        detail:friendly.technicalDetail||rawEventText,actions:[{act:'diagnose',label:'一键诊断'}].concat(actions.slice(0,2))});
    }
    S.typing[id]=false;
  }
  if(id===S.active){ ui.render('chat'); ui.render('head'); ui.render('rail'); ui.render('tasks'); ui.render('main'); }
}
async function refreshArts(id){
  if(!S.online) return;
  try{ S.arts[id] = await api('/v1/jobs/'+id+'/artifacts'); S.artsLoaded[id] = true; }
  catch(e){ if(S.artsLoaded[id] !== true) S.artsLoaded[id] = false; }
}
async function loadAtts(id){ if(S.online&&id){ try{ S.atts[id] = await api('/v1/jobs/'+id+'/attachments'); }catch(e){ S.atts[id]=[]; } ui.render('atts'); } }

/* ================= 步骤计时 ================= */
// 右栏这份是「给人看的」阶段名,和引擎内部代号一一对应但可以更好读。
// 最后一步引擎叫「出Word质检」,横幅里早就翻成「生成 Word 并检查」,右栏却还在用原代号,
// 同一步在两个面板叫两个名字,用户会以为是两件事。
const DEFAULT_STAGES = ['体检素材','图片入库','读懂组成','提取格式','评分废标','拆解分工',
                        '分章撰写','逐条应答','汇总成册','配图复核','自查体检','生成 Word 并检查'];
function ts2ms(s){ if(!s) return 0; const d = new Date(String(s).replace(/-/g,'/')); return isNaN(d) ? 0 : d.getTime(); }
function fmtDur(ms){
  if(!(ms>0)) return '';
  const s = Math.round(ms/1000);
  if(s < 60) return s+' 秒';
  const m = Math.floor(s/60);
  if(m < 60) return m+' 分'+(s%60 ? (s%60)+' 秒' : '');
  return Math.floor(m/60)+' 小时 '+(m%60)+' 分';
}
function timing(id){
  const st = S.steps[id]||{}; const keys = Object.keys(st).map(Number).sort((a,b)=>a-b);
  const p = S.prog[id]||{}; const total = p.total||12, cur = p.step||0;
  const j = (S.jobs||[]).find(x=>x.job_id===id);
  const state = j ? jobState(j) : (p.pct>=100 ? 'done' : 'running');
  const terminal = !!p.terminal || p.pct>=100 || ['done','stopped','unknown','paused'].indexOf(state)>=0;
  const times = (S.eventTimes[id]||[]).length ? S.eventTimes[id] : keys.map(k=>st[k]);
  const now = Date.now(), clock = activeClock(times, now, terminal);
  const elapsed = clock.active, idle = clock.idle;
  if(!times.length) return {elapsed:0, idle:0, eta:0, total, cur, rough:false};
  let eta = 0, rough = false;
  if(cur >= 1 && p.pct < 100 && S.stageAvgs){
    // 每步均值(本机历史优先,缺的用参考值):第一步就能给预计,且不被单个超长步带偏
    let rem = 0;
    for(let i = cur; i <= total; i++){
      const a = S.stageAvgs[i - 1] || {}; let sec = a.avg_s || 120;
      if(!a.from_history) rough = true;
      if(i === cur){
        const begin = st[cur] || times[0];
        const currentTimes = times.filter(t=>t>=begin); if(currentTimes[0]!==begin) currentTimes.unshift(begin);
        sec = Math.max(sec - activeClock(currentTimes, now, terminal).active / 1000, sec * 0.1);
      }
      rem += sec;
    }
    eta = rem * 1000;
  } else if(cur > 1 && p.pct < 100){
    const per = elapsed / Math.max(1, cur - 1);
    eta = per > 0 ? per * (total - cur + 1) : 0;
  }
  if(eta && eta < 5000) eta = 0;
  return {elapsed, idle, eta, total, cur, rough};
}

function jobState(j){
  if(j.state) return j.state;                       // 新引擎:直接用它的结论
  const p = (S.prog[j.job_id]&&S.prog[j.job_id].pct)!=null ? S.prog[j.job_id].pct : j.pct||0;
  const st = (S.prog[j.job_id]&&S.prog[j.job_id].stage) || j.stage || '';
  if(j.staged) return 'staged';                     // 旧引擎:尽量还原,别退回两档
  if(p>=100) return 'done';
  if(/^已暂停/.test(st)) return 'paused';
  if(/^已停止/.test(st)) return 'stopped';
  return 'running';
}
function verdict(id){
  const h = S.health[id];
  if(!h) return {key:'none', color:'var(--dim)', fix:false};
  const gaps = h.gaps||[];
  const fix = gaps.some(g=>/逐字|重复|异常/.test(g.title||''));   // 生成内容坏了,可一键修复
  if(h.level==='red' || gaps.some(g=>g.level==='red')) return {key:'bad', color:'var(--red)', fix};
  if(gaps.some(g=>g.level==='yellow')) return {key:'warn', color:'var(--amber)', fix};
  return {key:'ok', color:'var(--green)', fix};
}

export { loadPipeline, loadCoverage, maybeRefreshP0, covReasonHint,
  stopJobPolling, loadJobs, pollJobState, startJobPolling, clearStreamRecovery,
  resetStreamReplayState, markStreamOpen, recordStreamFailure, select, attachES,
  eventIsRecent, handle, refreshArts, loadAtts, DEFAULT_STAGES, ts2ms, fmtDur, timing,
  jobState, verdict };
