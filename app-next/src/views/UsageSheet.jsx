// 用量看板:按任务 / 模型 / 天看 token、费用、耗时与复读命中。数据来自 /v1/usage(引擎逐次模型调用记账)。
// 发 Key 模式的运营基础:没有这张表,谁用了多少、哪个模型爱复读,全靠猜。
import React, { useEffect, useState } from 'react';
import { Modal, Table, Statistic, Segmented, Tag, Empty, Tooltip } from 'antd';
import { S, ui, api, select, _shortDuration } from '../core/index.js';

const fmtTokens = n => n == null ? '—' : (Number(n) >= 10000 ? (Number(n) / 10000).toFixed(1) + ' 万' : String(Number(n).toLocaleString()));
export function fmtCost(cost, currency){
  if(cost == null || cost === '') return '—';
  const c = String(currency || 'USD').toUpperCase();
  return (c === 'CNY' || c === 'RMB' ? '¥' : '$') + Number(cost).toFixed(Number(cost) < 1 ? 3 : 2);
}

export default function UsageSheet(){
  const open = !!(S.sheet && S.sheet.name === 'usage');
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if(!open) return;
    let alive = true;
    setStatus('统计中…'); setData(null);
    if(!S.online){ setStatus('连接本地服务后才有真实用量'); return; }
    api('/v1/usage?days=' + days).then(r => { if(alive){ setData(r); setStatus(''); } })
      .catch(e => { if(alive) setStatus('读取失败:' + ((e && e.message) || '')); });
    return () => { alive = false; };
  }, [open, days]);
  const t = (data && data.totals) || {};
  const repeatRate = t.chapters ? Math.round((t.repeat_hits || 0) / t.chapters * 1000) / 10 : null;
  const jobCols = [
    { title: '任务', dataIndex: 'name', ellipsis: true,
      render: (v, r) => <a onClick={() => { ui.closeAll(); select(r.job_id); }}>{v || r.job_id}</a> },
    { title: '模型', dataIndex: 'model', ellipsis: true, width: 150, render: v => v || '—' },
    { title: '调用', dataIndex: 'calls', width: 64, align: 'right', className: 'num' },
    { title: 'tokens', dataIndex: 'total_tokens', width: 90, align: 'right', className: 'num',
      render: (v, r) => <Tooltip title={r.estimated ? '网关没有返回用量,按字数估算' : '网关返回的真实用量'}>{fmtTokens(v)}{r.estimated ? '≈' : ''}</Tooltip> },
    { title: '费用', dataIndex: 'estimated_cost', width: 80, align: 'right', className: 'num', render: (v, r) => fmtCost(v, r.currency) },
    { title: '耗时', dataIndex: 'elapsed_seconds', width: 80, align: 'right', className: 'num', render: v => v != null ? _shortDuration(v) : '—' },
    { title: '复读', dataIndex: 'repeat_hits', width: 70, align: 'right', className: 'num',
      render: (v, r) => v ? <Tag color="error" bordered={false}>{v}/{r.chapters || '?'}</Tag> : <span style={{ color: 'var(--faint)' }}>0</span> },
  ];
  const modelCols = [
    { title: '模型', dataIndex: 'model', ellipsis: true, render: v => v || '(未记录)' },
    { title: '任务', dataIndex: 'jobs', width: 64, align: 'right', className: 'num' },
    { title: '调用', dataIndex: 'calls', width: 64, align: 'right', className: 'num' },
    { title: 'tokens', dataIndex: 'total_tokens', width: 90, align: 'right', className: 'num', render: fmtTokens },
    { title: '费用', dataIndex: 'estimated_cost', width: 80, align: 'right', className: 'num', render: (v, r) => fmtCost(v, r.currency) },
    { title: '复读率', dataIndex: 'repeat_rate', width: 80, align: 'right', className: 'num', render: v => v == null ? '—' : v + '%' },
  ];
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={860} centered title="用量看板">
      <div id="usageSheet" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Segmented size="small" value={days} onChange={v => setDays(Number(v))}
            options={[{ label: '近 7 天', value: 7 }, { label: '近 30 天', value: 30 }, { label: '近 90 天', value: 90 }, { label: '全部', value: 3650 }]} />
          <span className="desc2" style={{ flex: 1 }}>按任务创建时间统计;tokens 带 ≈ 的是网关没返回用量、按字数估算的</span>
        </div>
        {status ? <div className="desc2">{status}</div> : null}
        {data && (
          <>
            <div className="usage-grid" id="usageTotals">
              <div className="usage-item"><Statistic title="任务" value={t.jobs || 0} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></div>
              <div className="usage-item"><Statistic title="模型调用" value={t.calls || 0} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></div>
              <div className="usage-item"><Statistic title="tokens" value={fmtTokens(t.total_tokens)} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></div>
              <div className="usage-item"><Statistic title="预估费用" value={fmtCost(t.estimated_cost, t.currency)} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></div>
              <div className="usage-item"><Statistic title="总耗时" value={t.elapsed_seconds ? _shortDuration(t.elapsed_seconds) : '—'} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></div>
              <div className="usage-item"><Statistic title="章节复读率" value={repeatRate == null ? '—' : repeatRate + '%'} valueStyle={{ fontSize: 18, fontWeight: 600, color: repeatRate ? 'var(--red)' : undefined }} /></div>
            </div>
            <div>
              <div className="lbl2">按模型</div>
              <Table size="small" rowKey="model" pagination={false} columns={modelCols} dataSource={data.by_model || []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有模型调用记录" /> }} />
            </div>
            <div>
              <div className="lbl2">按任务</div>
              <Table size="small" rowKey="job_id" pagination={{ pageSize: 12, size: 'small', hideOnSinglePage: true }}
                columns={jobCols} dataSource={data.jobs || []} id="usageJobs"
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个时间段没有任务" /> }} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
