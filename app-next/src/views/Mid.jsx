// 中栏:页签(标书大纲/执行过程/对话与要求)+ 流程台 + 对话 + 工作日志。
// 页签默认逻辑、流程台视图模型、消息渲染逐字对应经典 currentMidTab/renderFlowConsole/renderChat/renderWorklog。
import React, { useLayoutEffect, useRef } from 'react';
import { S, ui, bump, flowConsoleView, taskPresentation, phaseTimingLabel, timing, fmtDur,
         jobState, _friendlyText, _friendlyActionLabel, errAction, answer, ASK_SELF } from '../core/index.js';
import { mdHtml } from '../lib.js';
import Outline from './Outline.jsx';
import ConfirmCard from './ConfirmCard.jsx';

const MID_TABS = [['outline', '标书大纲'], ['flow', '执行过程'], ['chat', '对话与要求']];

function _chapterNodes(id){
  const p = S.pipeline[id]; const nodes = (p && p.pipeline && p.pipeline.nodes) || [];
  return nodes.filter(n => String(n.id || '').indexOf('chapter_write:') === 0);
}
export function currentMidTab(id){
  if(S.midTab[id]) return S.midTab[id];
  if(_chapterNodes(id).length) return 'outline';
  if(((S.arts[id]) || []).some(a => /^章节_/.test(a.name || ''))) return 'outline';
  const job = (S.jobs || []).find(x => x.job_id === id);
  return (job && job.flow) ? 'flow' : 'chat';
}

const STATE_LABELS = { done: '已完成', active: '进行中', attention: '需关注', failed: '未完成', pending: '等待中' };

function FlowConsole(){
  const id = S.active, job = (S.jobs || []).find(x => x.job_id === id);
  if(!id || !job) return null;
  const vm = flowConsoleView(job.flow, S.streamState[id], S.prog[id]);
  const p = taskPresentation(job);
  const selectedId = (S.flowPhaseSelection[id] && vm.phases.some(x => x.id === S.flowPhaseSelection[id])) ? S.flowPhaseSelection[id] : vm.currentPhase;
  const selected = vm.phases.find(x => x.id === selectedId) || vm.phases[0];
  const checks = Array.isArray(selected.checks) ? selected.checks : [];
  const selectedTiming = phaseTimingLabel(selected), selectedIsCurrent = selected.id === vm.currentPhase;
  // 排队中的节点本来就没有细节可说(经典同注释)
  const nodeDetail = x => x.detail || ({ done: '已写完', active: '正在处理', attention: '需要你确认',
    failed: '未完成,可重试', pending: '排队等待,前面的节点完成后自动开始' }[String(x.state)] || '排队等待');
  const kicker = { preparing: '尚未开始', generating: '生成进行中', needs_input: '等待你确认',
    completed: '已完成', failed: '已停止' }[p.state] || '生成进行中';
  return (
    <section className="flow-console">
      <div className="flow-top">
        <div className="flow-copy">
          <div className="flow-kicker">{kicker}</div>
          <div className="flow-title">生成流程台 · {vm.currentAction}</div>
          <div className="flow-sub"><span>{vm.checkpoint}</span><span>最近活动 {p.lastActivity}</span>{vm.recoverable && <span>可从检查点恢复</span>}</div>
        </div>
        <span className={'flow-connection ' + vm.connectionMode}><i className="dot" style={{ background: 'currentColor' }} />{vm.connectionLabel}</span>
      </div>
      <div className="flow-track">
        {vm.phases.map(x => (
          <button key={x.id} type="button" className={'flow-phase ' + x.state + (x.id === selected.id ? ' selected' : '')}
            data-phase={x.id} aria-pressed={x.id === selected.id}
            onClick={() => { S.flowPhaseSelection[id] = x.id; bump(); }}>
            <div className="flow-phase-head"><i className="flow-phase-dot" /><b>{x.label}</b></div>
            <span title={x.evidence || x.detail}>{x.detail || x.evidence || '等待执行'}</span>
            {phaseTimingLabel(x) ? <small className="flow-phase-time">{phaseTimingLabel(x)}</small> : null}
          </button>
        ))}
      </div>
      <section className="flow-detail" aria-live="polite">
        <div className="flow-detail-head">
          <div className="flow-detail-heading">
            <div className="flow-detail-kicker">{selectedIsCurrent ? '当前阶段' : '阶段详情'}</div>
            <div className="flow-detail-title">{selected.label}</div>
          </div>
          <span className={'flow-detail-status ' + selected.state}>{STATE_LABELS[selected.state] || '等待中'}</span>
          {!selectedIsCurrent && <div className="flow-detail-actions">
            <button type="button" className="flow-follow" onClick={() => { delete S.flowPhaseSelection[id]; bump(); }}>定位当前节点</button></div>}
        </div>
        <div className="flow-detail-summary">{selected.detail || '等待执行'}</div>
        <div className="flow-detail-meta">
          <span><b>耗时：</b>{selectedTiming || '尚未开始'}</span>
          <span><b>断点：</b>{vm.checkpoint}</span>
          {vm.recoverable && <span><b>恢复：</b>已保留完成内容</span>}
        </div>
        <div className="flow-detail-evidence"><b>本阶段产物：</b>{selected.evidence || '开始后生成验收证据'}</div>
        <div className="flow-node-list">
          {checks.length ? checks.map((x, i) => (
            <div key={i} className={'flow-node-row ' + x.state}><i className="flow-node-dot" />
              <div className="flow-node-copy"><b>{x.label || x.id || '未命名节点'}</b><span>{nodeDetail(x)}</span></div>
              <small className="flow-node-state">{STATE_LABELS[x.state] || '等待中'}</small></div>
          )) : <div className="flow-node-empty">该阶段尚无子节点记录；开始执行后会在这里展示每个节点的状态、耗时和重试情况。</div>}
        </div>
      </section>
    </section>
  );
}

function ChatMessages(){
  const boxRef = useRef(null);
  const list = S.msgs[S.active] || [];
  useLayoutEffect(() => {
    const box = boxRef.current; if(!box) return;
    box.scrollTop = box.scrollHeight;    // 挂载/更新后贴底;用户上翻的场景由外层滚动容器判断保留
  });
  // 解析确认问题不走通用气泡:confirmHost 里有结构化确认卡(经典同注释)
  const q = S.chips[S.active] && S.chips[S.active].kind === 'confirm_parse' ? null : S.chips[S.active];
  const options = q ? (q.options || []).slice() : [];
  if(q && options.length) options.push(ASK_SELF);
  return (
    <div className="chatwrap" id="chatWrap" ref={boxRef}>
      {list.map((m, mi) => {
        if(m.role === 'sys') return <div className="sysline" key={mi}><span className="sdot2" />{m.text}</div>;
        const u = m.role === 'user';
        return (
          <div key={mi} className={'msg ' + (u ? 'u' : 'a') + (m._fail ? ' fail' : '')}>
            <div className="b">
              {u ? m.text : <span dangerouslySetInnerHTML={{ __html: mdHtml(m.text) }} />}
              {!u && m.actions && m.actions.length ? (
                <div className="chips" style={{ marginTop: 8 }}>
                  {m.actions.map((a, ai) => <span key={ai} className={'chip' + (ai ? ' gy' : '')}
                    data-eact={a.act} data-eparam={a.param || ''}
                    onClick={() => errAction(a.act, a.file || '', a.param || '')}>{_friendlyActionLabel(a.label)}</span>)}
                </div>
              ) : null}
            </div>
            <div className="m">{u ? (m._fail ? <>你 · <span className="rs" onClick={() => {
              const l = S.msgs[S.active] || []; const idx = l.indexOf(m);
              if(idx >= 0){ l.splice(idx, 1); bump(); import('../core/index.js').then(c => c.say(m.text)); }
            }}>未送达,点此重发</span></> : '你') : '中标狗'}</div>
          </div>
        );
      })}
      {q && options.length > 0 && (
        <div className="chips">{options.map((o, i) => <span key={o} className={'chip' + (i ? ' gy' : '')}
          onClick={() => answer(o)}>{o}</span>)}</div>
      )}
      {S.typing[S.active] && <div className="typing"><span className="tdot" /><span className="tdot" /><span className="tdot" /><span>中标狗 正在回复…</span></div>}
    </div>
  );
}

function Worklog(){
  const id = S.active, wl = (id && S.worklog[id]) || [];
  const preRef = useRef(null);
  const stickRef = useRef(true);
  useLayoutEffect(() => {
    const b = preRef.current; if(!b) return;
    if(stickRef.current) b.scrollTop = b.scrollHeight;
  });
  const p0 = S.prog[id] || {};
  const j0 = (S.jobs || []).find(x => x.job_id === id);
  const running = j0 ? jobState(j0) === 'running' : (p0.pct || 0) < 100 && p0.step;
  if(!wl.length){
    if(!running) return null;
    const t = timing(id);
    const bits = [p0.stage ? '正在:' + _friendlyText(p0.stage) : '正在启动'];
    if(p0.step) bits.push('第 ' + p0.step + '/' + (p0.total || 12) + ' 步');
    if(t && t.elapsed) bits.push('已用 ' + fmtDur(t.elapsed));
    return (
      <details className="wl" open><summary>⚙ 它正在做什么</summary>
        <pre>{bits.join(' · ')}{'\n\n'}当前生成方式没有返回完整过程记录，所以这里只显示阶段进度。{'\n'}产物会在右侧「已产出」里逐个出现——那是它真的在干活的证据。</pre>
      </details>
    );
  }
  const live = (p0.pct || 0) < 100;
  return (
    <details className="wl" open={live}><summary>{live ? '⚙ 它正在做什么' : '⚙ 工作过程回放 · ' + wl.length + ' 行'}</summary>
      <pre id="wlBody" ref={preRef} onScroll={e => { const b = e.target; stickRef.current = b.scrollTop + b.clientHeight >= b.scrollHeight - 30; }}>{wl.join('\n')}</pre>
    </details>
  );
}

export default function Mid(){
  const id = S.active;
  const job = id ? (S.jobs || []).find(x => x.job_id === id) : null;
  const on = !!(id && job);
  const tab = on ? currentMidTab(id) : 'chat';
  return (
    <div id="chat" className="mid">
      {on && (
        <div className="cwrap"><div className="midtabs" id="midTabs">
          {MID_TABS.map(([k, label]) => <button key={k} type="button" data-midtab={k} className={k === tab ? 'on' : ''}
            onClick={() => { S.midTab[id] = k; bump(); }}>{label}</button>)}
        </div></div>
      )}
      <div className="cwrap"><ConfirmCard /></div>
      {on && tab === 'outline' && <div className="cwrap" id="outlineHost"><Outline /></div>}
      {(!on || tab === 'flow') && <div className="cwrap" id="flowHost"><FlowConsole /></div>}
      {(!on || tab === 'chat') && <div className="cwrap"><ChatMessages /></div>}
      {(!on || tab === 'chat') && <div className="cwrap"><Worklog /></div>}
    </div>
  );
}
