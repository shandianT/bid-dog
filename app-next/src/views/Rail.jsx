// 右栏:进度 / 已产出 / 参考资料 / 出件前检查。
// 出件前检查卡的文案逻辑逐字对应经典 renderRail(含 PR #10 的完整标题+详情句式);
// 进度与产物分组的完整形态在视图迁移 B 精化(基础信息已可用)。
import React, { useRef } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { S, ui, bump, verdict, timing, fmtDur, DEFAULT_STAGES, _friendlyText, wordPresence } from '../core/index.js';
import { addRef } from './newjob-core.js';
import { fmtSize } from '../lib.js';

export default function Rail(){
  const id = S.active;
  if(!id) return null;
  const p = S.prog[id] || {};
  const t = timing(id);
  const total = p.total || 12, cur = p.step || 0;
  const arts = S.arts[id] || [];
  const atts = Array.isArray(S.atts[id]) ? S.atts[id] : ((S.atts[id] || {}).items || []);
  const hth = S.health[id];
  const refIn = useRef(null);
  const openGaps = hth ? (hth.gaps || []).filter(g => g.level !== 'green') : [];
  const first = openGaps[0];
  const warnD = !hth ? '出 Word 后在这里看结论与补料清单'
    : first ? (_friendlyText(first.title || '') + (first.detail ? ' —— ' + _friendlyText(first.detail) : '')
               + (openGaps.length > 1 ? '(点开看全部 ' + openGaps.length + ' 项)' : '(点开逐条处理)'))
    : '关键检查已通过,可以准备提交';
  const eta = t.eta ? ((t.rough ? '约 ' : '预计还需 ') + fmtDur(t.eta)) : '';
  return (
    <div className="rail" id="rail">
      <div className="card" style={{ flex: 'none' }}>
        <div className="ch"><span className="ct">进度
          <span className="tgl" onClick={() => { S.stepsOpen = !S.stepsOpen; bump(); }}>{S.stepsOpen ? '收起' : '展开'}</span></span>
          <span className="cr" id="etaTop">{eta}</span></div>
        <div id="miniProg">{cur ? ('第 ' + cur + '/' + total + ' 步' + (p.stage ? ' · ' + _friendlyText(p.stage) : '')) : (p.stage ? _friendlyText(p.stage) : '等待任务开始')}</div>
        {S.stepsOpen && (
          <div id="phases">
            {DEFAULT_STAGES.map((name, i) => {
              const k = i + 1;
              const st = k < cur ? 'done' : k === cur ? 'cur' : '';
              const at = (S.steps[id] || {})[k];
              return <div key={k} className={'ph ' + st}><i />{name}{at && st === 'done' ? <small>{new Date(at).toTimeString().slice(0, 5)}</small> : null}</div>;
            })}
          </div>
        )}
      </div>
      <div className="card" style={{ flex: 1, minHeight: 0 }}>
        <div className="ch"><span className="ct">已产出 <span id="artCount">{arts.length ? arts.length : ''}</span></span>
          <span className="addref" onClick={() => ui.openJobFolder()}>打开任务文件夹</span></div>
        <div className="cardlist" id="files">
          {arts.length ? arts.map((a, i) => (
            <div key={a.name || i} className="art" onClick={() => ui.openArtifact(a.name, a.url || '')} title={a.name}>
              <span className="an">{a.name}</span>
              {a.size_kb ? <small>{Math.round(a.size_kb)} KB</small> : null}
            </div>
          )) : <span style={{ font: '400 12px/1.6 inherit', color: 'var(--faint)' }}>生成过程中陆续出现</span>}
        </div>
      </div>
      <div className="card" style={{ flex: 'none' }}>
        <div className="ch"><span className="ct">参考资料</span>
          <span className="addref" onClick={() => {
            if(!S.online){ ui.toast('未连接本地服务'); return; }
            refIn.current && refIn.current.click();
          }}><PlusOutlined style={{ fontSize: 12 }} /> 添加</span></div>
        <div id="attsList">
          {atts.length ? atts.map((a, i) => <div key={i} className="att" title={a.name || a}>{a.name || a}</div>)
            : <span style={{ font: '400 12px/1.6 inherit', color: 'var(--faint)' }}>给 AI 的写法参照,如过往标书</span>}
        </div>
        <input ref={refIn} type="file" multiple style={{ display: 'none' }}
          accept=".docx,.doc,.pdf,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.webp"
          onChange={e => { const fs = Array.from(e.target.files); (async () => { for(const f of fs) await addRef(f); })(); e.target.value = ''; }} />
      </div>
      <div className="card warncard" onClick={() => ui.openCheck()}>
        <div className="t"><span className="dot" id="warnDot" style={{ background: hth ? verdict(id).color : 'var(--amber)' }} />
          <span id="warnT">{hth ? '提交前需处理 ' + openGaps.length + ' 项' : '出件前检查'}</span></div>
        <div className="d" id="warnD">{warnD}</div>
      </div>
    </div>
  );
}
