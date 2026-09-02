// 素材库里的「待确认的事实」:入库时小模型从过往标书抽出的公司 / 资质 / 业绩 / 人员,
// 逐条勾选后「确认入库」才写进 公司介绍.md / 资质与案例.md;不确认永远不进正文。
import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Tag, Collapse } from 'antd';
import { S, ui, api } from '../core/index.js';

const LABELS = { qualifications: ['资质证书', r => [r.name, r.level, r.issuer, r.valid_until].filter(Boolean).join(' · ')],
                 performances: ['业绩', r => [r.project, r.client, r.amount, r.date, r.role].filter(Boolean).join(' · ')],
                 people: ['人员', r => [r.name, r.title, r.certs].filter(Boolean).join(' · ')] };

export default function FactsPanel({ refreshKey }){
  const [items, setItems] = useState([]);
  const [drop, setDrop] = useState({});       // id → Set('people:2')
  const [busy, setBusy] = useState('');
  async function load(){
    if(!S.online) return;
    try{ const r = await api('/v1/assets/facts'); setItems(r.items || []); }catch(_){}
  }
  useEffect(() => { load(); }, [refreshKey]);
  useEffect(() => {
    // 抽取在后台跑:有 running 的记录就每 3 秒看一眼
    if(!items.some(x => x.status === 'running')) return;
    const t = setTimeout(load, 3000); return () => clearTimeout(t);
  }, [items]);
  const pending = items.filter(x => x.status === 'pending' || x.status === 'running' || x.status === 'failed');
  if(!pending.length) return null;
  function toggle(id, key){ setDrop(d => { const s = new Set(d[id] || []); s.has(key) ? s.delete(key) : s.add(key); return { ...d, [id]: s }; }); }
  async function decide(rec, action){
    setBusy(rec.id + action);
    try{
      const dropped = drop[rec.id] || new Set();
      const facts = rec.facts ? { company: dropped.has('company') ? {} : rec.facts.company,
        qualifications: (rec.facts.qualifications || []).filter((_, i) => !dropped.has('qualifications:' + i)),
        performances: (rec.facts.performances || []).filter((_, i) => !dropped.has('performances:' + i)),
        people: (rec.facts.people || []).filter((_, i) => !dropped.has('people:' + i)) } : null;
      const r = await api('/v1/assets/facts/' + rec.id, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'confirm' ? { action, facts } : { action }) });
      ui.toast(action === 'confirm' ? ('✓ 已写入 ' + (r.written || []).join('、')) : '已丢弃这份抽取');
      load();
    }catch(e){ ui.toast('操作失败:' + ((e && e.message) || '')); }
    setBusy('');
  }
  return (
    <div id="factsPanel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="lbl2">待确认的事实 · {pending.length}</div>
      <div className="desc2">入库时从过往标书抽出的公司 / 资质 / 业绩 / 人员;勾掉不对的,确认后才写进 公司介绍.md 与 资质与案例.md。</div>
      {pending.map(rec => {
        const f = rec.facts || {}; const dropped = drop[rec.id] || new Set();
        const row = (key, i, text) => (
          <div key={key + i} className="fact-row">
            <Checkbox checked={!dropped.has(key + ':' + i)} onChange={() => toggle(rec.id, key + ':' + i)}>{text}</Checkbox>
          </div>);
        return (
          <div className="fact-card" key={rec.id} data-fact={rec.id}>
            <div className="fact-head">
              <b>{rec.source}</b>
              <Tag bordered={false} color={rec.status === 'pending' ? 'processing' : rec.status === 'running' ? 'default' : 'error'}>
                {rec.status === 'pending' ? (rec.count + ' 条') : rec.status === 'running' ? '抽取中…' : '抽取失败'}</Tag>
              <span style={{ flex: 1 }} />
              {rec.status === 'pending' && <Button size="small" type="primary" loading={busy === rec.id + 'confirm'} className="fact-confirm"
                onClick={() => decide(rec, 'confirm')}>确认入库</Button>}
              <Button size="small" loading={busy === rec.id + 'discard'} onClick={() => decide(rec, 'discard')}>丢弃</Button>
            </div>
            {rec.status === 'failed' && <div className="desc2">{rec.error || '模型没有返回可用结果'}</div>}
            {rec.status === 'pending' && (
              <div className="fact-body">
                {f.company && f.company.name && (
                  <div className="fact-row"><Checkbox checked={!dropped.has('company')} onChange={() => toggle(rec.id, 'company')}>
                    投标人:{f.company.name}{f.company.intro ? ' · ' + f.company.intro : ''}</Checkbox></div>)}
                {Object.keys(LABELS).map(key => (f[key] || []).length ? (
                  <div key={key}><div className="fact-kind">{LABELS[key][0]}</div>{(f[key] || []).map((r, i) => row(key, i, LABELS[key][1](r)))}</div>
                ) : null)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
