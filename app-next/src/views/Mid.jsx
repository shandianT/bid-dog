// 中栏:页签(标书大纲/执行过程/对话与要求)+ 流程台 + 对话 + 工作日志。
// 页签默认逻辑、流程台视图模型、消息渲染逐字对应经典 currentMidTab/renderFlowConsole/renderChat/renderWorklog。
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Card, Steps, List, Tag, Alert, Empty, Badge, Progress } from 'antd';
import { ThoughtChain } from '@ant-design/x';
import { CheckCircleFilled, LoadingOutlined, CloseCircleFilled, ClockCircleOutlined } from '@ant-design/icons';
import { S, ui, bump, flowConsoleView, taskPresentation, phaseTimingLabel, timing, fmtDur,
         jobState, _friendlyText, _friendlyActionLabel, errAction, answer, ASK_SELF } from '../core/index.js';
import { mdHtml } from '../lib.js';
import Outline, { _chapterNodes, _fmtWords } from './Outline.jsx';
import ConfirmCard from './ConfirmCard.jsx';

const MID_TABS = [['outline', '标书大纲'], ['flow', '执行过程'], ['chat', '对话与要求']];

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
  const currentIndex = Math.max(0, vm.phases.findIndex(x => x.id === vm.currentPhase));
  const trackRef = useRef(null);
  // antd Steps 不透传任意 DOM 属性,契约要的 data-phase 在渲染后按顺序打上(幂等)
  useLayoutEffect(() => {
    const nodes = trackRef.current ? trackRef.current.querySelectorAll('.ant-steps-item') : [];
    vm.phases.forEach((ph, i) => { if(nodes[i]) nodes[i].setAttribute('data-phase', ph.id); });
  });
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
      {/* 真 antd Steps:测试钉的是 .flow-phase[data-phase],用 items.className + 副作用打点保住 */}
      <div className="flow-track" ref={trackRef}>
        <Steps size="small" labelPlacement="vertical" current={currentIndex}
          onChange={i => { const ph = vm.phases[i]; if(ph){ S.flowPhaseSelection[id] = ph.id; bump(); } }}
          items={vm.phases.map(x => ({
            className: 'flow-phase ' + x.state + (x.id === selected.id ? ' selected' : ''),
            status: x.state === 'done' ? 'finish' : x.state === 'active' ? 'process'
              : (x.state === 'attention' || x.state === 'failed') ? 'error' : 'wait',
            title: <span className="fp-t">{x.label}</span>,
            description: (
              <span className="fp-d">
                <span title={x.evidence || x.detail}>{x.detail || x.evidence || '等待执行'}</span>
                {phaseTimingLabel(x) ? <small className="flow-phase-time num">{phaseTimingLabel(x)}</small> : null}
              </span>
            ),
          }))} />
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
          {checks.length ? (
            <List size="small" split={false} dataSource={checks}
              renderItem={x => (
                <List.Item className={'flow-node-row ' + x.state}>
                  <List.Item.Meta
                    avatar={x.state === 'done' ? <CheckCircleFilled style={{ color: 'var(--green)' }} />
                      : x.state === 'active' ? <LoadingOutlined style={{ color: 'var(--blue)' }} />
                      : (x.state === 'attention' || x.state === 'failed') ? <CloseCircleFilled style={{ color: 'var(--red)' }} />
                      : <ClockCircleOutlined style={{ color: 'var(--faint)' }} />}
                    title={<span className="fn-t">{x.label || x.id || '未命名节点'}</span>}
                    description={<span className="fn-d">{nodeDetail(x)}</span>} />
                  <span className="flow-node-state">{STATE_LABELS[x.state] || '等待中'}</span>
                </List.Item>
              )} />
          ) : <div className="flow-node-empty">该阶段尚无子节点记录；开始执行后会在这里展示每个节点的状态、耗时和重试情况。</div>}
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
                  {m.actions.map((a, ai) => <Tag.CheckableTag key={ai} checked={!ai} className={'chip' + (ai ? ' gy' : '')}
                    data-eact={a.act} data-eparam={a.param || ''}
                    onChange={() => errAction(a.act, a.file || '', a.param || '')}>{_friendlyActionLabel(a.label)}</Tag.CheckableTag>)}
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
        <div className="chips">{options.map((o, i) => <Tag.CheckableTag key={o} checked={!i} className={'chip' + (i ? ' gy' : '')}
          onChange={() => answer(o)}>{o}</Tag.CheckableTag>)}</div>
      )}
      {S.typing[S.active] && <div className="typing"><span className="tdot" /><span className="tdot" /><span className="tdot" /><span>中标狗 正在回复…</span></div>}
    </div>
  );
}

function Worklog(){
  const id = S.active, wl = (id && S.worklog[id]) || [];
  const p0 = S.prog[id] || {};
  const j0 = (S.jobs || []).find(x => x.job_id === id);
  const running = j0 ? jobState(j0) === 'running' : (p0.pct || 0) < 100 && p0.step;
  const live = (p0.pct || 0) < 100;
  // 台词按「── 第 N 步 · 名称 ──」分段,正好落成 ThoughtChain 的一节:
  // 标题=这一步在干什么,内容=它逐行报的事实。
  const items = [];
  wl.forEach(line => {
    const m = String(line).match(/^──\s*(.+?)\s*──$/);
    if(m) items.push({ title: m[1], lines: [] });
    else {
      if(!items.length) items.push({ title: '准备中', lines: [] });
      items[items.length - 1].lines.push(line);
    }
  });
  if(!wl.length){
    // 没有台词时降级成「进度 + 已等多久」(经典同注释:至少让人知道它还活着、活在哪一步)
    if(!running) return null;
    const t = timing(id);
    const bits = [p0.stage ? '正在:' + _friendlyText(p0.stage) : '正在启动'];
    if(p0.step) bits.push('第 ' + p0.step + '/' + (p0.total || 12) + ' 步');
    if(t && t.elapsed) bits.push('已用 ' + fmtDur(t.elapsed));
    return (
      <Card variant="borderless" className="lcard-a" title="它正在做什么"
        extra={<Tag color="processing" bordered={false}>进行中</Tag>}>
        <ThoughtChain items={[{ key: 'now', title: bits.join(' · '), status: 'pending',
          description: '当前生成方式没有返回完整过程记录,所以这里只显示阶段进度。产物会在右侧「已产出」里逐个出现——那是它真的在干活的证据。' }]} />
      </Card>
    );
  }
  return (
    <Card variant="borderless" className="lcard-a" title={live ? '它正在做什么' : '工作过程回放'}
      extra={live ? <Tag color="processing" bordered={false}>进行中</Tag>
                  : <span className="lx num">{wl.length} 行</span>}>
      <div className="wl-scroll">
        <ThoughtChain collapsible items={items.map((it, i) => ({
          key: String(i),
          title: it.title,
          status: (live && i === items.length - 1) ? 'pending' : 'success',
          content: <div className="wl-lines">{it.lines.map((l, k) => <div className="wl-line" key={k}>{l}</div>)}</div>,
        }))} />
      </div>
    </Card>
  );
}

// 章节撰写:原型的双列网格,数据来自真实 pipeline(写完的显示字数,正在写的有呼吸点)
function Chapters(){
  const id = S.active; if(!id) return null;
  const nodes = _chapterNodes(id);
  if(!nodes.length) return null;
  const arts = S.arts[id] || [];
  const done = nodes.filter(n => n.state === 'done').length;
  return (
    <Card variant="borderless" className="lcard-a"
      title={<span>章节撰写 <span className="num" style={{ color: 'var(--dim)', fontWeight: 450 }}>{done}/{nodes.length}</span></span>}
      extra={<span className="lx">每写完一节即存检查点 · 中途停下不丢内容</span>}>
      <Progress percent={Math.round(done / nodes.length * 100)} showInfo={false} size={['100%', 4]}
        strokeColor="var(--green)" trailColor="var(--line-soft)" style={{ marginBottom: 10 }} />
      <div className="chgrid">
        {nodes.map(n => {
          const out = (n.outputs && n.outputs[0]) || '';
          const art = arts.find(a => a.name === out);
          const st = n.state === 'done' ? 'done'
            : (n.state === 'running' || n.state === 'retry_wait') ? 'writing'
            : (n.state === 'failed' || n.state === 'blocked') ? 'failed' : 'queued';
          const meta = st === 'done' ? (_fmtWords(art && art.size_kb) || '已完成')
            : st === 'writing' ? '撰写中 ↑'
            : st === 'failed' ? '未完成' : '排队中';
          return (
            <div className={'chrow ' + st} key={n.id}
              onClick={() => { if(st === 'done' && out) ui.openPreview(out); }}>
              {st === 'done' ? <span className="chok">✓</span>
                : st === 'writing' ? <i className="pulse" />
                : st === 'failed' ? <i className="chfail" /> : <i className="qdot" />}
              <span className="chname" title={n.title || n.id}>{n.title || n.id}</span>
              <span className="chmeta num">{meta}</span>
            </div>
          );
        })}
      </div>
    </Card>
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
      {(!on || tab === 'flow') && <div className="cwrap" id="flowHost">
        <Card variant="borderless" className="lcard-a"><FlowConsole /></Card></div>}
      {on && tab === 'flow' && <div className="cwrap"><Chapters /></div>}
      {(!on || tab === 'chat') && <div className="cwrap"><ChatMessages /></div>}
      {(!on || tab === 'chat') && <div className="cwrap"><Worklog /></div>}
    </div>
  );
}
