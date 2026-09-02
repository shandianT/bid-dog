// 中栏:两个页签——「对话」= 聊天(问进度、提要求、回答 AI 的提问,输入框发出去自动切过来);
// 「标书」= 一行可收起的执行过程 + 标书视图(左目录、右正文)。流程台视图模型、消息渲染逐字对应经典。
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Card, Steps, List, Tag, Button } from 'antd';
import { ThoughtChain } from '@ant-design/x';
import { CheckCircleFilled, LoadingOutlined, CloseCircleFilled, ClockCircleOutlined, RightOutlined } from '@ant-design/icons';
import { S, ui, bump, flowConsoleView, taskPresentation, phaseTimingLabel, timing, fmtDur, knownStep,
         jobState, publicTaskState, _friendlyText, _friendlyActionLabel, errAction, answer, ASK_SELF } from '../core/index.js';
import { mdHtml } from '../lib.js';
import Outline, { _chapterNodes } from './Outline.jsx';
import ConfirmCard from './ConfirmCard.jsx';

const STATE_LABELS = { done: '已完成', active: '进行中', attention: '需关注', failed: '未完成', pending: '等待中' };

const MID_TABS = [['chat', '对话'], ['show', '标书']];
const TAB_HINT = { chat: '问进度、提要求;AI 的提问也在这里回答', show: '目录在左,正文在右;执行过程收在最上面一行' };

// 默认页签:AI 在等你回答 → 对话;有章节或有流程可看 → 展示;什么都还没有 → 对话。用户点过就记住。
export function currentMidTab(id){
  if(S.midTab[id]) return S.midTab[id];
  const chip = S.chips[id];
  if(chip && chip.kind !== 'confirm_parse') return 'chat';
  if(_chapterNodes(id).length) return 'show';
  if(((S.arts[id]) || []).some(a => /^章节_/.test(a.name || ''))) return 'show';
  const job = (S.jobs || []).find(x => x.job_id === id);
  return (job && job.flow) ? 'show' : 'chat';
}

function FlowConsole(){
  const id = S.active, job = (S.jobs || []).find(x => x.job_id === id);
  if(!id || !job) return null;
  const vm = flowConsoleView(job.flow, S.streamState[id], S.prog[id]);
  const p = taskPresentation(job);
  const selectedId = (S.flowPhaseSelection[id] && vm.phases.some(x => x.id === S.flowPhaseSelection[id])) ? S.flowPhaseSelection[id] : vm.currentPhase;
  const selected = vm.phases.find(x => x.id === selectedId) || vm.phases[0];
  const checks = Array.isArray(selected.checks) ? selected.checks : [];
  // 任务没在跑,未完成阶段的「已用 / 已超出」只是从开始时刻数到现在的钟,不是真干活的时间:停了就只报常规耗时
  const frozen = publicTaskState(job) !== 'generating';
  const timingOf = x => phaseTimingLabel(frozen && String(x.state) !== 'done'
    ? Object.assign({}, x, { elapsed_seconds: null, overdue_seconds: 0, remaining_seconds: null }) : x);
  const selectedTiming = timingOf(selected), selectedIsCurrent = selected.id === vm.currentPhase;
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
                {timingOf(x) ? <small className="flow-phase-time num">{timingOf(x)}</small> : null}
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
  const stick = useRef(true);            // 只在用户本来就贴着底时才跟随(经典 nearBottom 同语义)
  const list = S.msgs[S.active] || [];
  // 滚的是中栏 .mid(经典的 el('chat')),.chatwrap 自身不滚——写它等于什么都没做。
  const scroller = () => boxRef.current && boxRef.current.closest('.mid');
  // 渲染阶段读到的是「这批新内容提交之前」的位置,正是经典在改 innerHTML 之前算 nearBottom 的时刻。
  const before = scroller();
  if(before) stick.current = before.scrollTop + before.clientHeight > before.scrollHeight - 90;
  useLayoutEffect(() => {
    const sc = scroller();               // 用户上翻读历史时不打断,回到底部后重新跟随
    if(sc && stick.current) sc.scrollTop = sc.scrollHeight;
  });
  // 解析确认问题不走通用气泡:confirmHost 里有结构化确认卡(经典同注释)
  const q = S.chips[S.active] && S.chips[S.active].kind === 'confirm_parse' ? null : S.chips[S.active];
  const options = q ? (q.options || []).slice() : [];
  if(q && options.length) options.push(ASK_SELF);
  return (
    <div className="chatwrap" id="chatWrap" ref={boxRef}>
      {!list.length && !q && !S.typing[S.active] && (
        <div className="chat-empty">还没有对话。问进度、提要求,或回答 AI 的提问,都在这里。</div>
      )}
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
  // 日志会长到几百行:容器限高滚动,并且只在用户本来就贴着底时跟到最新(经典 stick 同语义)。
  const logRef = useRef(null), stick = useRef(true);
  const beforeLog = logRef.current;      // 同上:提交前的位置才是「用户此刻在看哪儿」
  if(beforeLog) stick.current = beforeLog.scrollTop + beforeLog.clientHeight >= beforeLog.scrollHeight - 30;
  useLayoutEffect(() => {
    const b = logRef.current;
    if(b && stick.current) b.scrollTop = b.scrollHeight;
  });
  const id = S.active, wl = (id && S.worklog[id]) || [];
  const p0 = S.prog[id] || {};
  const j0 = (S.jobs || []).find(x => x.job_id === id);
  const running = j0 ? jobState(j0) === 'running' : (p0.pct || 0) < 100 && p0.step;
  const live = !!running && (p0.pct || 0) < 100;   // 停下的任务不是「进行中」,是回放
  // 台词按「── 第 N 步 · 名称 ──」分段,正好落成 ThoughtChain 的一节:
  // 标题=这一步在干什么,内容=它逐行报的事实。
  // 量过:492 行分一次 0.047ms,而一次事件驱动的整树提交中位 8.4ms——记忆化省下的是
  // 千分之六,却要赌「台词数组只会 push、不会原地改」。不值得,原样重算。
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
      <div className="wl-scroll" ref={logRef}>
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

// 执行过程一行摘要 + 展开/收起:没有章节可看、或任务停了/没完成 → 默认展开;在写/已完成 → 收成一行。
// 这一行只说流程台自己的事(当前阶段 / 第几步 / 断点),状态由顶栏徽章说,不再复读顶栏副题。
function FlowSection({ id, job, open }){
  const prog = S.prog[id] || {};
  const vm = flowConsoleView(job.flow, S.streamState[id], prog);
  const cur = vm.phases.find(x => x.id === vm.currentPhase) || vm.phases[0];
  const k = knownStep(job, prog, 12);
  return (
    <div className={'sec flow-sec' + (open ? ' open' : '')}>
      <button type="button" className="sec-head sec-toggle" id="flowToggle" aria-expanded={open}
        onClick={() => { S.flowOpen[id] = !open; bump(); }}>
        <RightOutlined className={'sec-caret' + (open ? ' open' : '')} />
        <span className="sec-title">执行过程</span>
        <span className="sec-meta">{[cur ? cur.label : '', k ? '第 ' + k + '/12 步' : '', vm.checkpoint].filter(Boolean).join(' · ')}</span>
        <span className="sec-x">{open ? '收起' : '展开'}</span>
      </button>
      {open && <>
        <Card variant="borderless" className="lcard-a"><FlowConsole /></Card>
        <Worklog />
      </>}
    </div>
  );
}

export default function Mid(){
  const id = S.active;
  const job = id ? (S.jobs || []).find(x => x.job_id === id) : null;
  const on = !!(id && job);
  const tab = on ? currentMidTab(id) : 'chat';
  // 「对话」页签上的角标:待在「展示」里时新到的回复数(只数 AI 的话,进度系统行和自己发的不算);
  // AI 在等回答则直接写「待回答」
  const replies = ((id && S.msgs[id]) || []).filter(m => m.role !== 'user' && m.role !== 'sys').length;
  if(id && (tab === 'chat' || S.midSeen[id] == null)) S.midSeen[id] = replies;
  const unread = (on && tab !== 'chat') ? Math.max(0, replies - (S.midSeen[id] || 0)) : 0;
  const chip = on ? S.chips[id] : null;
  const asking = !!(chip && chip.kind !== 'confirm_parse' && tab !== 'chat');
  // 「展示」页签上常驻章节进度:在对话里也知道写到哪了
  const nodes = on ? _chapterNodes(id) : [];
  const chDone = nodes.filter(n => n.state === 'done').length;
  const hasOutline = on && (nodes.length > 0 || (S.arts[id] || []).some(a => /^章节_/.test(a.name || '')));
  const st = job ? publicTaskState(job) : '';
  const flowDefault = !hasOutline || st === 'failed';
  const flowOpen = on && (S.flowOpen[id] != null ? !!S.flowOpen[id] : flowDefault);
  return (
    <div id="chat" className="mid">
      {on && (
        <div className="cwrap midbar-wrap"><div className="midbar">
          <div className="midtabs" id="midTabs" role="tablist">
            {MID_TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" data-midtab={k} aria-selected={k === tab} className={k === tab ? 'on' : ''}
                onClick={() => { S.midTab[id] = k; bump(); }}>
                {label}
                {k === 'chat' && asking ? <i className="tab-badge ask">待回答</i>
                  : k === 'chat' && unread ? <i className="tab-badge num">{unread}</i>
                  : k === 'show' && nodes.length ? <i className="tab-sub num">{chDone}/{nodes.length} 章</i> : null}
              </button>
            ))}
          </div>
          <span className="midbar-hint">{TAB_HINT[tab]}</span>
        </div></div>
      )}
      <div className="cwrap"><ConfirmCard /></div>
      {on && tab === 'show' && <div className="cwrap" id="flowHost"><FlowSection id={id} job={job} open={flowOpen} /></div>}
      {on && tab === 'show' && <div className="cwrap" id="outlineHost"><Outline /></div>}
      {(!on || tab === 'chat') && <div className="cwrap chat-sec"><ChatMessages /></div>}
    </div>
  );
}
