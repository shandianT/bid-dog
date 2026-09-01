// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。
// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。
/* FRONTEND_STABILITY_PURE_START */
const ACTIVE_GAP_MS = 10 * 60 * 1000;
function isBodyWordArtifact(a){
  const name = String((a&&a.name)||'');
  if(!/\.docx$/i.test(name)) return false;
  if(/自检|清洗|报告|质检|门禁|矩阵|偏离表|解析版|配图清单|补料|废标|组成|索引|格式要求|大纲|\.bak/i.test(name)) return false;
  if(!/投标|技术标|商务标|标书|方案|响应文件/i.test(name)) return false;
  return a == null || a.size_kb == null || Number(a.size_kb) > 0;
}
function wordPresence(arts, loaded, hasWord){
  if((arts||[]).some(isBodyWordArtifact)) return 'ready';
  if(hasWord === true) return 'ready';
  return loaded === true || hasWord === false ? 'missing' : 'unknown';
}
function completionGate(state, pct, word){
  // pct 是 agent 的进度信号，不是交付事实；老引擎的兼容判断已在 jobState() 内完成。
  const rawDone = state === 'done';
  return {rawDone, complete:rawDone && word === 'ready',
          missingWord:rawDone && word === 'missing', checkingWord:rawDone && word === 'unknown'};
}
function activeClock(timestamps, nowMs, terminal, gapMs){
  const cap = Number(gapMs) > 0 ? Number(gapMs) : ACTIVE_GAP_MS;
  const ts = [...new Set((timestamps||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(!ts.length) return {active:0, idle:0, span:0};
  if(!terminal && Number.isFinite(Number(nowMs)) && Number(nowMs) > ts[ts.length-1]) ts.push(Number(nowMs));
  let active = 0, idle = 0;
  for(let i=1;i<ts.length;i++){
    const d = Math.max(0, ts[i]-ts[i-1]);
    active += Math.min(d, cap); idle += Math.max(0, d-cap);
  }
  return {active, idle, span:active+idle};
}
function eventStreamUrl(apiBase, id, offset){
  return String(apiBase||'').replace(/\/$/,'') + '/v1/jobs/' + encodeURIComponent(id)
    + '/events?offset=' + Math.max(0, Number(offset)||0);
}
const FLOW_CONSOLE_PHASES = [
  ['environment','环境准备',0,0],['parse','招标解析',1,4],['plan','响应规划',5,6],
  ['write','并行撰写',7,8],['assemble','Word 装配',9,10],['deliver','交付质检',11,12]
];
function nextStreamState(current, event){
  const old=current||{}, kind=String(event||'');
  if(kind==='open') return {mode:(Number(old.failures)>0||old.mode==='polling'||old.mode==='reconnecting')?'recovered':'connected',failures:0};
  if(kind==='error'){
    const failures=Math.max(0,Number(old.failures)||0)+1;
    return {mode:failures>=3?'polling':'reconnecting',failures};
  }
  if(kind==='settled') return {mode:'connected',failures:0};
  return {mode:String(old.mode||'idle'),failures:Math.max(0,Number(old.failures)||0)};
}
function streamReconnectDelay(failures){
  return [3000,4000,6000,10000][Math.min(3,Math.max(0,(Number(failures)||1)-1))];
}
function phaseDuration(seconds){
  const value=Math.max(0,Math.round(Number(seconds)||0));
  if(value<60)return value+'秒';
  const minutes=Math.floor(value/60),rest=value%60;
  if(minutes<60)return rest?minutes+'分'+rest+'秒':minutes+'分钟';
  const hours=Math.floor(minutes/60),mins=minutes%60;
  return hours+'小时'+(mins?mins+'分钟':'');
}
// 「实际 8 小时 · 通常 1 分钟」这种数字一定是计时基准取错了(阶段起点算到了建任务那一刻,
// 中间全是用户没点开始的空档)。与其把它当事实播出去,不如退回「通常 X」——宁可少说,不能说错。
// 判据和引擎侧保持一致:超出常规 20 倍且绝对值也大得离谱,才认定不可信。
function phaseElapsedTrustworthy(elapsed, expected){
  const e=Number(elapsed), x=Number(expected);
  if(!Number.isFinite(e)) return false;
  if(e > 12*3600) return false;                          // 单阶段跑满半天,真实生成里不存在
  if(!Number.isFinite(x) || x <= 0) return true;
  return e <= Math.max(x*20, 1800);
}
function phaseTimingLabel(phase){
  const p=phase||{},expected=p.expected_seconds,remaining=p.remaining_seconds;
  const elapsed=(p.elapsed_seconds!=null && !phaseElapsedTrustworthy(p.elapsed_seconds,expected))
    ? null : p.elapsed_seconds;
  if(expected==null)return '';
  // 「实际 0秒 · 通常 1分钟」是反馈截图里的原话:阶段被本地秒过或计时缺失时
  // 不该硬凑一个 0 出来,只显示常规耗时甚至留白。
  if(String(p.state)==='done'&&elapsed!=null)
    return elapsed>0?('实际 '+phaseDuration(elapsed)+' · 通常 '+phaseDuration(expected)):'';
  if(elapsed==null)return '通常 '+phaseDuration(expected);
  let label='已用 '+phaseDuration(elapsed)+' · 通常 '+phaseDuration(expected);
  if(Number(p.overdue_seconds)>0)label+=' · 已超出 '+phaseDuration(p.overdue_seconds);
  else if(remaining!=null)label+=' · 预计还需 '+phaseDuration(remaining);
  return label;
}
function flowConsoleView(flow, stream, progress){
  const raw=flow&&typeof flow==='object'?flow:{}, p=progress||{};
  const cp=raw.checkpoint||{}, step=Math.max(0,Math.min(12,Number(cp.step!=null?cp.step:p.step)||0));
  const supplied=Array.isArray(raw.phases)?raw.phases:[];
  let current=String(raw.current_phase||'');
  if(!current) current=(FLOW_CONSOLE_PHASES.find(x=>step>=x[2]&&step<=x[3])||FLOW_CONSOLE_PHASES[0])[0];
  const currentIndex=Math.max(0,FLOW_CONSOLE_PHASES.findIndex(x=>x[0]===current));
  const phases=FLOW_CONSOLE_PHASES.map((definition,index)=>{
    const found=supplied.find(x=>x&&x.id===definition[0]);
    if(found) return {id:definition[0],label:String(found.label||definition[1]),state:String(found.state||'pending'),
      detail:String(found.detail||''),evidence:String(found.evidence||''),checks:Array.isArray(found.checks)?found.checks:[],
      elapsed_seconds:found.elapsed_seconds==null?null:Number(found.elapsed_seconds),
      expected_seconds:found.expected_seconds==null?null:Number(found.expected_seconds),
      remaining_seconds:found.remaining_seconds==null?null:Number(found.remaining_seconds),
      overdue_seconds:found.overdue_seconds==null?0:Number(found.overdue_seconds),
      estimate_source:String(found.estimate_source||'')};
    return {id:definition[0],label:definition[1],state:index<currentIndex?'done':index===currentIndex?'active':'pending',
      detail:index===currentIndex?String(p.stage||'正在处理'):index<currentIndex?'已验证完成':'等待执行',evidence:'',checks:[]};
  });
  const mode=String((stream||{}).mode||'idle');
  // 这个徽标只反映「界面↔本地服务」的进度同步,与大模型是否连得上无关——
  // 旧文案「实时连接」被一线当成模型连接状态,是「状态与实际不符」反馈的一部分。
  const labels={connected:'进度同步中',reconnecting:'进度同步中断·自动恢复中',polling:'改用定时刷新进度',recovered:'进度同步已恢复',idle:'等待任务开始'};
  const active=phases.find(x=>x.id===current)||phases[0];
  return {phases,currentPhase:current,currentAction:String(raw.current_action||p.stage||active.detail||'正在准备任务'),
    checkpoint:cp.label?'已完成：'+String(cp.label):'尚未形成检查点',connectionMode:mode,
    connectionLabel:labels[mode]||labels.idle,recoverable:raw.recoverable!==false};
}
function withDiagnosticAction(actions){
  const out = (actions||[]).filter(a=>a && a.act !== 'bundle').map(a=>Object.assign({},a));
  out.push({act:'bundle', label:'导出诊断包'}); return out;
}
function healthUpdateInfo(health){
  const h = health || {}, u = h.update || h.upgrade || h.release_update || {};
  const available = u.available === true || u.status === 'available' || u.status === 'update_available'
    || h.update_available === true;
  if(!available) return null;
  const version = String(u.latest || u.version || h.latest_version || '').replace(/^v/,'');
  let url = String(u.url || u.release_url || h.release_url || '');
  const safe = /^https:\/\/github\.com\/shandianT\/bid-dog\/releases(?:\/|$)/i;
  if(!safe.test(url)) url = 'https://github.com/shandianT/bid-dog/releases/latest';
  const notes = String(u.notes || u.body || u.release_notes || h.update_notes || '').slice(0, 1200);
  return {version:version || '新版', url, notes};
}
function modeFromModel(model){
  const m = String(model||'');
  if(/flash|lite|turbo|mini|nano/i.test(m)) return 'fast';
  if(/s2|pro|max|plus/i.test(m) && !/flash|lite|turbo|mini|nano/i.test(m)) return 'quality';
  return null;
}
function modeSwitchBlocked(jobs){
  return (jobs||[]).some(j=>j && (j.state === 'running' || j.state === 'paused'));
}
function engineConnectionGate(online, stale){
  if(online)return {ready:true,switching:false,message:''};
  if(stale)return {ready:false,switching:true,
    message:'检测到旧版本地引擎，正在安全切换到新版；若旧任务仍在收尾，完成后会自动连接。Key 尚未提交或保存。'};
  return {ready:false,switching:false,message:'本地引擎尚未连接，Key 尚未提交或保存；请先运行一键诊断。'};
}
const PUBLIC_TASK_LABELS = {
  preparing:'准备中', generating:'生成中', needs_input:'需要你确认', completed:'已完成', failed:'未完成'
};
// 任务本身是否已经产出可交付的整册 Word。只看任务对象上的权威字段,不依赖
// 产物列表是否已经拉回来——侧栏在产物加载完之前也要说对话。
function jobHasDeliverable(job){
  const j = job || {}, d = j.delivery || (j.presentation||{}).delivery || {};
  return j.has_word === true || d.has_word === true;
}
function taskGroupOpen(key, stored, bulk){
  if(bulk)return true;
  const state=stored||{};
  if(Object.prototype.hasOwnProperty.call(state,key))return state[key]===true;
  return ['preparing','generating','needs_input'].indexOf(key)>=0;
}
function _displayStateCode(value){
  const s = String(value||'').toLowerCase().replace(/[\s-]+/g,'_');
  const map = {
    preparing:'preparing', prepare:'preparing', staged:'preparing', waiting:'preparing',
    generating:'generating', running:'generating', processing:'generating', checking:'generating', finalizing:'generating',
    needs_input:'needs_input', needs_attention:'needs_input', attention:'needs_input', awaiting_input:'needs_input',
    paused:'needs_input', review:'needs_input', needs_review:'needs_input',
    completed:'completed', complete:'completed', done:'completed', success:'completed', ready:'completed', ready_to_deliver:'completed',
    failed:'failed', failure:'failed', stopped:'failed', unknown:'failed', interrupted:'failed', incomplete:'failed'
  };
  if(map[s]) return map[s];
  if(/准备|待开始/.test(value||'')) return 'preparing';
  if(/生成|进行|检查中/.test(value||'')) return 'generating';
  if(/确认|等待你|暂停/.test(value||'')) return 'needs_input';
  if(/完成|可交付/.test(value||'')) return 'completed';
  if(/失败|未完成|中断|停止|不明/.test(value||'')) return 'failed';
  return '';
}
function publicTaskState(job){
  const j = job || {}, p = j.presentation || {}, delivery = j.delivery || p.delivery || {};
  const explicit = _displayStateCode(p.code || p.display_state || p.state || j.display_state || j.public_state || j.ui_state);
  if(explicit) return explicit;
  const pending = Number(p.pending_questions || p.attention_count || j.pending_questions || j.pending_question_count || 0);
  if(p.needs_attention === true || p.awaiting_input === true || j.needs_attention === true || pending > 0) return 'needs_input';
  const ds = _displayStateCode(delivery.state || delivery.status || delivery.result_state);
  if(ds === 'needs_input' || ds === 'failed') return ds;
  const st = _displayStateCode(j.state);
  if(st === 'completed'){
    if(j.has_word === false || delivery.has_word === false) return 'failed';
    if(ds === 'generating') return 'generating';
    return ds || 'completed';
  }
  return st || (j.staged ? 'preparing' : 'generating');
}
function _friendlyText(value){
  let s = String(value||'').trim();
  if(!s) return '';
  if(/执行外壳起来了但链路没通|执行外壳探活/.test(s))
    return '主连接响应较慢，已切换稳定通道继续；仍使用同一模型和同一套要求，不会降低内容标准。';
  s = s.replace(/OpenCode(?:\s+Server)?|Codex\s*CLI|Claude\s*Code|CLI/gi, '生成服务')
       .replace(/执行外壳/g, '生成服务').replace(/本地引擎/g, '本地服务')
       .replace(/探活/g, '连接检查').replace(/兼容模式/g, '稳定模式')
       .replace(/模型网关/g, '模型服务').replace(/中转层/g, '连接服务')
       .replace(/生成引擎/g, '生成方式').replace(/重跑本任务|重跑/g, '重新生成')
       .replace(/定向重做/g, '继续修改')
       .replace(/\bagent\b/gi, '生成助手')
       .replace(/状态不明[^，。·]*/g, '任务已中断');
  // 流程黑话 → 人话:一线售前看不懂自造词是「不知道该怎么用」反馈的主因之一。
  // 在展示层统一翻译,后端事件与既有任务数据不用动。
  s = s.replace(/体检素材/g, '检查资料').replace(/读懂组成/g, '分析招标文件')
       .replace(/评分废标/g, '找评分点与废标条款').replace(/拆解分工/g, '安排章节')
       .replace(/逐条应答/g, '逐条响应要求').replace(/汇总成册/g, '合成全文')
       .replace(/配图复核/g, '核对配图').replace(/自查体检/g, '自动检查')
       .replace(/出Word质检/g, '生成 Word 并检查')
       .replace(/落位锚点/g, '插图位置').replace(/出件前/g, '提交前');
  return s;
}
function _friendlyActionLabel(value){
  const s=String(value||'处理');
  if(/^(重跑|重跑本任务)$/.test(s)) return '重新生成';
  return s.replace(/定向重做不达标章节/g,'继续修改不达标章节')
          .replace(/定向重做这一章|重做这一章/g,'修改这一章')
          .replace(/定向重做/g,'继续修改')
          .replace(/去修生成引擎设置/g,'检查生成设置')
          .replace(/去换生成引擎/g,'切换生成方式');
}
function _shortDuration(seconds){
  const n = Math.max(0, Number(seconds)||0);
  if(!n) return '';
  if(n < 60) return Math.max(1, Math.round(n))+' 秒';
  if(n < 3600) return Math.max(1, Math.round(n/60))+' 分钟';
  const h = Math.floor(n/3600), m = Math.round((n%3600)/60);
  return h+' 小时'+(m ? ' '+m+' 分钟' : '');
}
function _relativeActivity(value, nowMs){
  if(!value) return '暂无活动记录';
  const ts = typeof value === 'number' ? value : Date.parse(String(value).replace(' ','T'));
  if(!Number.isFinite(ts)) return '最近有活动';
  const diff = Math.max(0, Number(nowMs||Date.now()) - ts);
  if(diff < 45000) return '刚刚';
  if(diff < 3600000) return Math.max(1,Math.round(diff/60000))+' 分钟前';
  if(diff < 86400000) return Math.max(1,Math.round(diff/3600000))+' 小时前';
  return Math.max(1,Math.round(diff/86400000))+' 天前';
}
function taskPresentation(job, nowMs){
  const j = job || {}, p = j.presentation || {}, state = publicTaskState(j);
  const defaults = {
    preparing:'正在准备任务', generating:'正在生成标书', needs_input:'有事项需要你确认',
    completed:'交付文件已准备好', failed:'任务未完成，已有内容已保存'
  };
  let action = _friendlyText(p.current_action || p.currentAction || j.current_action || j.stage || defaults[state]);
  if(state==='failed' && (!action || /启动中/.test(action))) action = defaults.failed;
  // 「出了整册 Word 但没过质检」和「什么都没出来」是两回事:前者手里有一份可编辑的
  // 交付稿,差的是几项提交前处理;后者是真的白跑。以前两种都写「未完成/已停止」,
  // 一线反馈「会被误解成失败了」——这话是对的,界面把「还差几步」说成了「全砸了」。
  if(jobHasDeliverable(j) && state==='failed') action = '已出件 · 提交前有待处理项';
  const activityAt = p.last_activity_at || p.lastActivityAt || j.last_activity_at || j.updated_at || j.last_event_at || j.created_at;
  const etaSec = p.eta_seconds != null ? p.eta_seconds : (p.eta_s != null ? p.eta_s
    : (j.eta_seconds != null ? j.eta_seconds : (j.eta != null ? j.eta : j.eta_s)));
  let eta = '';
  if(state==='preparing' || state==='generating') eta = Number(etaSec)>0 ? '约 '+_shortDuration(etaSec) : '正在估算';
  else if(state==='needs_input') eta = '等待你的操作';
  else if(state==='completed') eta = '已完成';
  else eta = '—';
  return {state, label:PUBLIC_TASK_LABELS[state], currentAction:action || defaults[state],
          lastActivity:_relativeActivity(activityAt, nowMs), eta};
}
// 后端 job_can() 会枚举的全部动作名(STATE_CAN + pause/resume 补丁)。
const CAN_LIST_AUTHORITATIVE = ['start','stop','pause','resume','rerun','redo','ask','export','delete'];
// 检查点是「已经落盘」的既成事实,重开应用也还在;SSE 实时步数只在本次会话里有值。
// 两者取大,进度条才不会在重开后掉回 0——这正是「进度显示与实际不符」的最后一条路径。
function checkpointStep(job){
  const flow = (job && job.flow) || {}, cp = flow.checkpoint || {};
  const raw = Number(cp.step != null ? cp.step : flow.step);
  return Number.isFinite(raw) ? Math.max(0, Math.min(12, Math.round(raw))) : 0;
}
function knownStep(job, live, total){
  const cap = Number(total) > 0 ? Number(total) : 12;
  return Math.min(cap, Math.max(Number((live||{}).step) || 0, checkpointStep(job)));
}
// 「没出 Word,未完成」是一句判死刑的话,只有在这一单真的没路可走时才该说。
// 还能从断点接着跑的任务不算:它缺的不是交付物,而是「还没跑完」——把两者混为一谈,
// 用户看到红牌就以为白干了,其实只要点一下「从断点继续」就能接着写。
function deliveryDeadEnd(job){
  return !taskCapabilities(job || {}).resume;
}
function taskCapabilities(job){
  const j = job || {}, p = j.presentation || {}, runtime = j.runtime || p.runtime || {};
  // 两个来源要「合并」而不是「谁在前谁通吃」:runtime.capabilities 通常只声明 pause 一项,
  // 一旦拿它整体遮蔽 can 列表,can 里的 resume 就再也读不到——真机表现是任务明明写着
  // 「可从检查点继续」,顶栏却永远没有「从断点继续」按钮,用户被困在半成品任务上。
  const detailed = [runtime.capabilities, j.capabilities, p.capabilities]
    .find(x => x && typeof x === 'object' && !Array.isArray(x)) || null;
  const listed = [j.can, runtime.capabilities, j.capabilities, p.capabilities].find(Array.isArray) || null;
  const capValue = name => {
    if(detailed && Object.prototype.hasOwnProperty.call(detailed, name)){
      const value = detailed[name];
      return value && typeof value==='object' ? value.enabled !== false : value !== false;
    }
    // can 列表只对它真正枚举的那几种动作有发言权。archive / live_instruction 这类
    // 后端从不下发的名字若也按「不在列表=不允许」判,归档按钮会被整片关掉。
    if(listed) return CAN_LIST_AUTHORITATIVE.indexOf(name) >= 0 ? listed.indexOf(name) >= 0 : null;
    return null;                                    // 两边都没说 = 未知,由各能力的默认值决定
  };
  const has = name => capValue(name);
  const pauseSpec = detailed && detailed.pause && typeof detailed.pause==='object' ? detailed.pause : {};
  const mode = String(runtime.mode || p.mode || p.runtime_mode || j.runtime_mode || j.execution_mode || '').toLowerCase();
  const stable = /stable|compat|fallback|cli/.test(mode);
  let pause = has('pause'); if(pause == null) pause = publicTaskState(j)==='generating';
  if(stable) pause = false;
  return {pause:!!pause, stop:has('stop')!==false, resume:has('resume')===true,
          archive:has('archive')!==false, rerun:has('rerun')!==false, export:has('export')!==false,
          liveInstruction:!stable && has('live_instruction')!==false,
          pauseReason:pause ? '' : (_friendlyText(pauseSpec.reason) || (stable ? '当前使用稳定模式，暂不支持暂停；任务会继续生成。' : '当前阶段暂不支持暂停。'))};
}
function friendlyRuntimeNotice(event){
  const e = event || {}, raw = String(e.text || e.message || '');
  const fallback = e.code==='stable_mode_enabled' || /执行外壳起来了但链路没通|执行外壳探活|改用兼容模式/.test(raw);
  return {text:fallback ? '主连接响应较慢，已切换稳定通道继续；仍使用同一模型和同一套要求，不会降低内容标准。' : _friendlyText(raw),
          technicalDetail:String(e.technical_detail || e.technicalDetail || e.detail || (fallback ? raw : '')),
          action:{act:'show_detail', label:'查看原因'}};
}
function diagnosticCheckView(item){
  const x=item||{};let status=String(x.status||x.state||'').toLowerCase();
  if(!status&&x.ok===true)status='pass';if(!status&&x.ok===false)status='fail';
  if(['pass','passed','ok','ready','success','green'].indexOf(status)>=0)return {state:'pass',symbol:'✓'};
  if(['warning','warn','attention','yellow'].indexOf(status)>=0)return {state:'warn',symbol:'△'};
  if(['fail','failed','error','red','missing'].indexOf(status)>=0)return {state:'fail',symbol:'✗'};
  return {state:'unknown',symbol:'·'};
}
function _checkView(raw, fallbackDetail){
  const r = raw || {};
  let state = String(r.state || r.status || '').toLowerCase();
  if(!state && r.ok === true) state='pass'; else if(!state && r.ok === false) state='fail';
  if(['green','passed','ready','ok','success'].indexOf(state)>=0) state='pass';
  if(['yellow','warning','attention','needs_attention'].indexOf(state)>=0) state='warn';
  if(['red','failed','error','missing'].indexOf(state)>=0) state='fail';
  if(['pass','warn','fail'].indexOf(state)<0) state='unknown';
  return {state, detail:String(r.detail || r.summary || fallbackDetail || (state==='unknown'?'尚未检查':''))};
}
function _deviationPart(label, raw){
  if(raw==null) return '';
  if(typeof raw==='number') return label+'表 已检测 · '+raw+' 条';
  if(typeof raw!=='object') return label+'表 '+String(raw);
  const status=String(raw.status||raw.state||'').toLowerCase();
  const present=raw.present===true||['pass','ok','ready','warn','warning'].indexOf(status)>=0;
  const missing=raw.present===false||['missing','fail','failed','error'].indexOf(status)>=0;
  const rows=raw.rows!=null?raw.rows:(raw.total_rows!=null?raw.total_rows:raw.count);
  return label+'表 '+(missing?'缺失':present?'已检测':'待检查')+(rows!=null?' · '+rows+' 条':'');
}
function deliveryViewModel(job, artifacts){
  const j = job || {}, p = j.presentation || {}, d = j.delivery || p.delivery || {}, checks = d.checks || {};
  let primary = d.primary_word || d.primary || d.word || null;
  if(typeof primary === 'string') primary = {name:primary};
  if(primary && primary.present === false) primary = null;
  if(!primary){ const hit=(artifacts||[]).find(isBodyWordArtifact); if(hit) primary=hit; }
  const toc = _checkView(checks.toc || d.toc);
  const dvRaw = checks.deviations || checks.deviation || d.deviations || d.deviation || {};
  const have = dvRaw.deviation_rows != null ? dvRaw.deviation_rows : (dvRaw.rows != null ? dvRaw.rows : dvRaw.actual);
  const want = dvRaw.score_rows != null ? dvRaw.score_rows : (dvRaw.expected_rows != null ? dvRaw.expected_rows : dvRaw.expected);
  const total = dvRaw.total_rows != null ? dvRaw.total_rows : null;
  const parts = [_deviationPart('技术',dvRaw.technical),_deviationPart('商务',dvRaw.business)].filter(Boolean);
  if(total != null && !parts.some(x=>x.indexOf('· '+total+' 条')>=0)) parts.push('共 '+total+' 条');
  const dvDetail = dvRaw.detail || (parts.length ? parts.join('、') : ((have!=null && want!=null) ? (have+'/'+want+' 条已覆盖') : '尚未检查'));
  const deviations = _checkView(dvRaw, dvDetail);
  if(deviations.state==='unknown'&&parts.length){
    const missing=[dvRaw.technical,dvRaw.business].some(x=>x&&typeof x==='object'&&x.present===false);
    deviations.state=missing?'warn':'pass';
  }
  deviations.detail = String(dvDetail);
  const quality = _checkView(checks.quality || d.quality || (checks.status != null ? checks : null));
  return {state:String(d.state||d.status||(d.ready===true?'ready':'unknown')), primary:primary||null, toc, deviations, quality,
          blockingCount:Number(d.blocking_count || quality.blocking_count || 0), raw:d};
}
/* FRONTEND_STABILITY_PURE_END */
export {
  ACTIVE_GAP_MS, isBodyWordArtifact, wordPresence, completionGate, activeClock, eventStreamUrl, FLOW_CONSOLE_PHASES, nextStreamState, streamReconnectDelay, phaseDuration, phaseElapsedTrustworthy, phaseTimingLabel, flowConsoleView, withDiagnosticAction, healthUpdateInfo, modeFromModel, modeSwitchBlocked, engineConnectionGate, PUBLIC_TASK_LABELS, jobHasDeliverable, taskGroupOpen, _displayStateCode, publicTaskState, _friendlyText, _friendlyActionLabel, _shortDuration, _relativeActivity, taskPresentation, CAN_LIST_AUTHORITATIVE, checkpointStep, knownStep, deliveryDeadEnd, taskCapabilities, friendlyRuntimeNotice, diagnosticCheckView, _checkView, _deviationPart, deliveryViewModel
};
