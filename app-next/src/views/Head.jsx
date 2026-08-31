// 任务头部:标题/徽章/副题/进度条/动作(暂停·停止·修改·从断点继续·开始·日志·交付结果·覆盖·出件前检查)。
// 全部判定公式逐字对应经典 renderHead(含 PR #10 的「待处理」徽章与「Word 已生成」lead)。
import React from 'react';
import { S, ui, jobState, publicTaskState, taskPresentation, taskCapabilities, wordPresence,
         completionGate, deliveryDeadEnd, verdict, timing, fmtDur, knownStep, PUBLIC_TASK_LABELS,
         resumeJob, togglePause, stopJob, rerunJob, say, deliveryViewModel } from '../core/index.js';
import { startStaged } from './newjob-core.js';

const PauseIcon = ({ paused }) => paused
  ? <svg className="i" viewBox="0 0 24 24" fill="currentColor" style={{width:13,height:13}}><polygon points="6 3 20 12 6 21 6 3"/></svg>
  : <svg className="i" viewBox="0 0 24 24" fill="currentColor" style={{width:13,height:13}}><rect x="5" y="4" width="4.5" height="16" rx="1"/><rect x="14.5" y="4" width="4.5" height="16" rx="1"/></svg>;

export function headModel(){
  const p = S.prog[S.active] || {};
  const j = S.jobs.find(x => x.job_id === S.active);
  const st = j ? jobState(j) : (p.pct >= 100 ? 'done' : 'running');
  const t = timing(S.active);
  const state = j ? publicTaskState(j) : (p.pct >= 100 ? 'completed' : 'generating');
  const present = taskPresentation(Object.assign({}, j || {}, (!j || !j.current_action) && p.stage ? { current_action: p.stage } : {}));
  const caps = taskCapabilities(j || { state: st, can: ['pause', 'stop'] });
  const word = wordPresence(S.arts[S.active], S.artsLoaded[S.active], j && j.has_word);
  const delivery = completionGate(st, p.pct, word);
  const missingWord = delivery.missingWord || (state === 'failed' && word === 'missing' && deliveryDeadEnd(j));
  if(st === 'paused') S.paused[S.active] = true;
  return { p, j, st, t, state, present, caps, word, delivery, missingWord };
}

function Quick({ done, caps }){
  if(!S.active) return null;
  let items = done
    ? [['q', '出件前我还差哪几项?'], ['q', '各章分别写了多少字?'], ['cmd:rerun', '重新生成']]
    : [['q', '现在到哪了?'], ['q', '有哪些废标风险?'], ['cmd:pause', S.paused[S.active] ? '继续生成' : '暂停一下']];
  if(!done && caps && caps.pause === false) items = items.filter(x => x[0] !== 'cmd:pause').concat([['q', '为什么当前不能暂停?']]);
  return (
    <div className="quick" id="quick">
      {items.map(([k, label]) => <span key={k + label} data-k={k} data-v={label}
        onClick={() => { if(k === 'q') say(label); else if(k === 'cmd:pause') togglePause(); else if(k === 'cmd:rerun') rerunJob(); }}>{label}</span>)}
    </div>
  );
}
export { Quick };

export default function Head(){
  if(!S.active) return null;
  const { p, j, st, t, state, present, caps, word, delivery, missingWord } = headModel();
  const done = delivery.complete;
  const vd = deliveryViewModel(j || {}, S.arts[S.active] || []);
  const deliverable = !!(j && vd.primary && (state === 'completed' || state === 'needs_input'));
  const showResult = deliverable && S.processView[S.active] !== true;
  const cov = S.coverage[S.active];

  // 徽章:PR #10——出了整册 Word 的 failed 不是失败,是待处理
  let badge;
  if(missingWord) badge = <span className="badge bad" id="hBadge"><span className="bdot" />没出 Word，未完成</span>;
  else if(state === 'failed' && word === 'ready') badge = <span className="badge warn" id="hBadge"><span className="bdot" />待处理</span>;
  else {
    const cls = { preparing: 'none', generating: 'none', needs_input: 'warn', completed: 'ok', failed: 'bad' }[state] || 'none';
    badge = <span className={'badge ' + cls} id="hBadge"><span className="bdot" />{PUBLIC_TASK_LABELS[state] || '未完成'}</span>;
  }

  // 副题 lead:PR #10——出了件先说出了件,再说还差什么
  let lead = present.currentAction;
  if(state === 'failed' && word === 'ready'){
    const open = ((S.health[S.active] || {}).gaps || []).filter(g => g.level !== 'green').length;
    lead = open ? ('Word 已生成 · 提交前需处理 ' + open + ' 项') : 'Word 已生成 · 质检未通过,请看出件前检查';
  }
  const parts = [lead, '最后活动 ' + present.lastActivity];
  if(present.eta && present.eta !== '—') parts.push(present.eta);
  if(t.elapsed && j && j.elapsed_seconds == null && j.elapsed == null) parts.push('已用 ' + fmtDur(t.elapsed));

  // 进度条:重开应用后 SSE 的 pct 是 0,但检查点仍在;取两者较大值,进度条才不会凭空清零。
  const cpPct = Math.round(knownStep(j, p, 12) / 12 * 100);
  const barPct = Math.max(Number(p.pct) || 0, Number(j && j.pct) || 0, delivery.complete ? 0 : cpPct);
  const barW = (missingWord || delivery.checkingWord ? Math.min(barPct, 99) : barPct) + '%';

  // 覆盖仪表(PR #10:title 汇总未覆盖原因)
  let covPill = null;
  if(cov && cov.available){
    const un = (cov.items || []).filter(x => !x.covered);
    const names = { unlocated: '还没落到具体章节', gap: '规划里还留着缺口', chapter_pending: '所在章节还没写完' };
    const tally = {};
    un.forEach(x => { const r = String(x.reason || '') || 'unlocated'; tally[r] = (tally[r] || 0) + 1; });
    const tip = !un.length ? '全部评分点都已覆盖'
      : '未覆盖 ' + un.length + ' 项:' + Object.keys(tally).sort((a, b) => tally[b] - tally[a]).map(r => (names[r] || r) + ' ' + tally[r] + ' 项').join('、') + '。点开逐条查看,可直接补写应答。';
    covPill = <span className={'pill covpill' + (cov.covered >= cov.total ? ' on' : '')} id="covPill" title={tip}
      onClick={() => ui.openCoverage()}>评分点覆盖 {cov.covered}/{cov.total}</span>;
  }

  return (
    <div className="head" id="head"><div className="hwrap">
      <div className="ht">
        <h1 id="hTitle">{(j && j.name) || S.active}</h1>
        <div className="sub" id="hSub">{parts.join(' · ')}</div>
        <div className="bar"><b id="hBar" style={{ width: barW }} /></div>
      </div>
      {badge}
      {state === 'generating' && S.online && (
        <span className="iconbtn" id="pauseBtn" aria-disabled={caps.pause ? 'false' : 'true'}
          style={{ opacity: caps.pause ? '' : 0.45 }}
          title={caps.pause ? (S.paused[S.active] ? '继续' : '暂停') : caps.pauseReason}
          onClick={caps.pause ? togglePause : () => ui.toast(caps.pauseReason)}>
          <PauseIcon paused={S.paused[S.active]} /></span>
      )}
      {S.online && caps.stop && (state === 'generating' || st === 'paused') &&
        <span className="pill" id="stopBtn" onClick={stopJob}>停止</span>}
      {(state === 'completed' || state === 'failed' || state === 'needs_input') && S.online &&
        <span className="pill" id="redoBtn" title="对已生成的结果提修改要求,出一个新版本" onClick={() => ui.openRedo()}>修改结果</span>}
      {S.online && caps.resume &&
        <span className="pill on" id="resumeBtn" title="从上次中断的检查点接着往下跑,已完成内容不重写" onClick={resumeJob}>从断点继续</span>}
      {j && (j.staged || state === 'preparing') && !S._startBusy &&
        <span className="pill on" id="startBtn" onClick={startStaged}>▶ 开始生成</span>}
      <span className="pill" id="logBtn" onClick={() => ui.openLog()}>运行日志</span>
      {deliverable && !showResult &&
        <span className="pill primary" id="resultTabBtn" onClick={() => { S.processView[S.active] = false; ui.render('main'); }}>交付结果</span>}
      {covPill}
      <span className={'pill' + ((state === 'completed' || state === 'failed' || state === 'needs_input') ? ' primary' : '')} id="hAct"
        onClick={() => ui.openCheck()}>
        {missingWord ? '查看未完成原因' : (state === 'completed' || state === 'needs_input' ? '查看待确认项' : '出件前检查')}</span>
    </div></div>
  );
}
