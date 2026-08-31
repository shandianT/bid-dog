// 解析确认卡:开始撰写前确认项目名/截止/资质/评分/废标风险。逐字对应经典 renderConfirmCard。
import React, { useState } from 'react';
import { S, ui, bump, api, answer } from '../core/index.js';

export default function ConfirmCard(){
  const chip = S.active ? S.chips[S.active] : null;
  const [fixOpen, setFixOpen] = useState(false);
  const [fixText, setFixText] = useState('');
  if(!chip || chip.kind !== 'confirm_parse' || !chip.payload) return null;
  const p = chip.payload;
  async function sendFix(){
    const text = fixText.trim();
    if(!text){ ui.toast('先写清楚要修正的内容'); return; }
    try{
      const r = await api('/v1/jobs/' + S.active + '/answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_id: chip.qid, text }) });
      if(r && r.ok === false) throw new Error(r.error || '修正未送达');
      S.chips[S.active] = null; setFixOpen(false); setFixText(''); bump();
    }catch(err){ ui.toast(err && err.message || '修正未送达,问题已保留,可重试'); }
  }
  return (
    <div className="confirm-card">
      <h4>开始撰写前,确认解析出的关键信息</h4>
      <div className="chd">发现读错了现在改一个字,胜过跑完 30 分钟后返工。修正会同步进任务要求,响应规划会按修正重新核对。</div>
      <dl className="confirm-kv">
        <dt>项目名称</dt><dd>{p.project || ''}</dd>
        <dt>递交截止</dt><dd>{p.deadline || ''}</dd>
        <dt>资质要求</dt><dd>{p.qualification || ''}</dd>
        <dt>评分办法</dt><dd>{p.scoring || ''}</dd>
        <dt>废标风险</dt><dd className="veto">{p.veto || ''}</dd>
      </dl>
      <div className="confirm-acts">
        <button type="button" className="btn-primary" onClick={() => answer((chip.options || [])[0] || '确认无误，开始撰写')}>
          {(chip.options || [])[0] || '确认无误，开始撰写'}</button>
        <button type="button" className="btn-plain" onClick={() => setFixOpen(v => !v)}>有误,需要修正</button>
      </div>
      {fixOpen && (
        <div className="confirm-fix">
          <textarea autoFocus value={fixText} onChange={e => setFixText(e.target.value)}
            placeholder="写清楚哪一项有误、应为什么。例:项目名应为「清湖片区二期」;资质要求应为市政公用工程总承包贰级" />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn-primary" onClick={sendFix}>提交修正并开始</button>
          </div>
        </div>
      )}
    </div>
  );
}
