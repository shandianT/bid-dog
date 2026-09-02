// 设置里的「试跑对比」:同一份招标文件按变体各起一单,结果表里分得开(tools/model_ab.py 的按钮版)。
import React, { useEffect, useState } from 'react';
import { Select, Input, Button, Table, Tag } from 'antd';
import { S, ui, api, select, _shortDuration } from '../core/index.js';
import { AG } from './settings-core.js';
import { fmtCost } from './UsageSheet.jsx';

const Q = { green: ['success', '通过'], yellow: ['warning', '建议项'], red: ['error', '必办项'] };

export default function AbPanel(){
  const [job, setJob] = useState(S.active || '');
  const [variants, setVariants] = useState('');
  const [group, setGroup] = useState(null);
  const [groups, setGroups] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const jobs = (S.jobs || []).filter(j => !j.archived_at);
  useEffect(() => {
    const base = AG.s2Model || '';
    if(!variants && base) setVariants(base + '\n' + base + '?temperature=0.5&frequency_penalty=0.4');
    if(S.online) api('/v1/ab').then(r => setGroups(r.groups || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if(!group || !group.running) return;
    const t = setTimeout(() => loadGroup(group.group), 5000); return () => clearTimeout(t);
  }, [group]);
  async function loadGroup(id){ try{ setGroup(await api('/v1/ab/' + id)); }catch(e){ setMsg('读取失败:' + ((e && e.message) || '')); } }
  async function run(){
    const list = variants.split('\n').map(x => x.trim()).filter(Boolean);
    if(!job){ setMsg('先选一个带招标文件的任务作为基准'); return; }
    if(!list.length){ setMsg('每行一个变体,如 deepseek-v4-flash?temperature=0.5'); return; }
    setBusy(true); setMsg('');
    try{
      const r = await api('/v1/ab/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: job, variants: list }) });
      setMsg('已起 ' + r.jobs.length + ' 单' + (r.errors && r.errors.length ? ';失败:' + r.errors.join('; ') : '') + ' — 跑完后下表自动更新');
      await loadGroup(r.group);
      api('/v1/ab').then(x => setGroups(x.groups || [])).catch(() => {});
      S.jobs = await api('/v1/jobs'); ui.render('tasks');
    }catch(e){ setMsg('✗ ' + ((e && e.message) || '起单失败')); }
    setBusy(false);
  }
  const cols = [
    { title: '变体', dataIndex: 'label', ellipsis: true, render: (v, r) => <a onClick={() => { ui.closeAll(); select(r.job_id); }}>{v || r.model}</a> },
    { title: '状态', dataIndex: 'state', width: 82, render: v => <Tag bordered={false} color={v === 'done' ? 'success' : (v === 'running' || v === 'staged') ? 'processing' : 'default'}>{
        { done: '完成', running: '生成中', staged: '排队', stopped: '停止' }[v] || v}</Tag> },
    { title: '覆盖', width: 78, align: 'right', className: 'num', render: (_v, r) => r.coverage ? r.coverage.covered + '/' + r.coverage.total : '—' },
    { title: '质检', dataIndex: 'quality', width: 76, render: v => v ? <Tag bordered={false} color={Q[v][0]}>{Q[v][1]}</Tag> : '—' },
    { title: '复读', dataIndex: 'repeat_hits', width: 60, align: 'right', className: 'num', render: v => v || 0 },
    { title: 'tokens', width: 84, align: 'right', className: 'num', render: (_v, r) => (r.usage && r.usage.total_tokens) ? r.usage.total_tokens.toLocaleString() + (r.usage.estimated ? '≈' : '') : '—' },
    { title: '费用', width: 70, align: 'right', className: 'num', render: (_v, r) => r.usage ? fmtCost(r.usage.estimated_cost, r.usage.currency) : '—' },
    { title: '耗时', dataIndex: 'elapsed_seconds', width: 80, align: 'right', className: 'num', render: v => v ? _shortDuration(v) : '—' },
  ];
  return (
    <div id="abPanel" style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 8 }}>
      <div className="desc2">同一份招标文件按变体各起一单;变体一行一个:<code>模型</code> 或 <code>模型?temperature=0.5&amp;frequency_penalty=0.4</code>,模型须已通过连接测试。全局默认参数不动。</div>
      <div style={{ display: 'flex', gap: 9 }}>
        <Select style={{ flex: 1 }} id="abJob" value={job || undefined} placeholder="基准任务(带招标文件)" onChange={setJob}
          options={jobs.map(j => ({ value: j.job_id, label: j.name || j.job_id }))} showSearch optionFilterProp="label" />
        <Button type="primary" id="abRun" loading={busy} onClick={run}>试跑对比</Button>
      </div>
      <Input.TextArea id="abVariants" rows={3} value={variants} onChange={e => setVariants(e.target.value)}
        placeholder={'deepseek-v4-flash\ndeepseek-v4-flash?temperature=0.5&frequency_penalty=0.4'} style={{ font: "400 12px/1.6 'SF Mono',Menlo,Consolas,monospace" }} />
      {msg && <div className="desc2" id="abMsg">{msg}</div>}
      {groups.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="lbl2" style={{ margin: 0 }}>最近对比</span>
          {groups.slice(0, 6).map(g => <Tag key={g.group} style={{ cursor: 'pointer' }} onClick={() => loadGroup(g.group)}>{g.name} · {(g.variants || []).length} 变体</Tag>)}
        </div>
      )}
      {group && (
        <Table size="small" rowKey="job_id" pagination={false} columns={cols} dataSource={group.rows || []} id="abTable"
          title={() => <span>{group.name} · {group.created_at}{group.running ? ' · 有变体还在跑,5 秒刷新一次' : ''}</span>} />
      )}
    </div>
  );
}
