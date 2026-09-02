// 产品能力表编辑器:表格 UI 改「功能|支持情况|版本要求|证明材料|可定制|配图」,读写素材库的 产品能力表.md。
// 它是应答判定的第一依据(SKILL 第 0 步),以前只能开记事本改。
import React, { useEffect, useState } from 'react';
import { Modal, Table, Input, Select, Button, Segmented, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { S, ui, api } from '../core/index.js';
import { CAP_COLUMNS, CAP_SUPPORT, parseCapabilityTable, serializeCapabilityTable } from './capability-core.js';

const NAME = '产品能力表.md';

export default function CapabilitySheet(){
  const open = !!(S.sheet && S.sheet.name === 'capability');
  const [doc, setDoc] = useState(null);         // { preamble, columns, rows, tail }
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState('table');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if(!open) return;
    let alive = true;
    setStatus('读取中…'); setDirty(false); setMode('table');
    if(!S.online){ setStatus('连接本地服务后可编辑'); return; }
    api('/v1/assets/text?name=' + encodeURIComponent(NAME)).then(r => {
      if(!alive) return;
      const text = r.exists ? r.text : r.template;
      setRaw(text); setDoc(parseCapabilityTable(text));
      setStatus(r.exists ? '' : '素材库里还没有能力表,下面是模板;保存后生成时就会按它判定应答');
    }).catch(e => { if(alive) setStatus('读取失败:' + ((e && e.message) || '')); });
    return () => { alive = false; };
  }, [open]);
  const columns = (doc && doc.columns && doc.columns.length) ? doc.columns : CAP_COLUMNS;
  function edit(ri, ci, value){
    setDoc(d => { const rows = d.rows.map(r => r.slice()); rows[ri][ci] = value; return { ...d, rows }; }); setDirty(true);
  }
  function addRow(){ setDoc(d => ({ ...d, rows: [...d.rows, columns.map(() => '')] })); setDirty(true); }
  function delRow(ri){ setDoc(d => ({ ...d, rows: d.rows.filter((_, i) => i !== ri) })); setDirty(true); }
  function switchMode(next){
    if(next === 'raw'){ setRaw(serializeCapabilityTable(doc)); }
    else { setDoc(parseCapabilityTable(raw)); }
    setMode(next);
  }
  async function save(){
    const text = mode === 'raw' ? raw : serializeCapabilityTable(doc);
    setSaving(true);
    try{
      await api('/v1/assets/text', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NAME, text }) });
      setDirty(false); setStatus('✓ 已保存到素材库/' + NAME + ',下一单生成起生效'); ui.toast('能力表已保存');
      if(mode === 'raw') setDoc(parseCapabilityTable(text)); else setRaw(text);
    }catch(e){ setStatus('✗ 保存失败:' + ((e && e.message) || '')); }
    setSaving(false);
  }
  const tableCols = columns.map((name, ci) => ({
    title: name, dataIndex: String(ci), key: ci, ellipsis: false,
    width: /支持/.test(name) ? 118 : (/可定制/.test(name) ? 96 : (/配图/.test(name) ? 110 : undefined)),
    render: (_v, row, ri) => /支持情况/.test(name)
      ? <Select size="small" style={{ width: '100%' }} value={row[ci] || undefined} placeholder="支持?"
          options={CAP_SUPPORT.map(x => ({ value: x }))} onChange={v => edit(ri, ci, v)} />
      : <Input size="small" variant="borderless" value={row[ci] || ''} placeholder={ci === 0 ? '功能点' : ''} onChange={e => edit(ri, ci, e.target.value)} />,
  })).concat([{ title: '', key: 'x', width: 40, render: (_v, _row, ri) => <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => delRow(ri)} /> }]);
  return (
    <Modal open={open} onCancel={ui.closeAll} width={920} centered title="产品能力表 · 应答判定的第一依据"
      okText={saving ? '保存中…' : '保存到素材库'} okButtonProps={{ loading: saving, id: 'capSave', disabled: !doc }} onOk={save} cancelText="关闭">
      <div id="capSheet" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Segmented size="small" value={mode} onChange={switchMode} options={[{ label: '表格', value: 'table' }, { label: '原文', value: 'raw' }]} />
          <span className="desc2" style={{ flex: 1 }}>每行一个功能点;「支持情况」只能是 支持 / 部分支持 / 不支持 / 可定制;「配图」填图片索引里的 ID。{dirty ? ' · 有未保存的修改' : ''}</span>
          {mode === 'table' && <Button size="small" icon={<PlusOutlined />} id="capAdd" onClick={addRow}>加一行</Button>}
        </div>
        {status ? <div className="desc2" id="capStatus">{status}</div> : null}
        {doc && mode === 'table' && (
          <Table size="small" rowKey={(_r, i) => String(i)} pagination={false} columns={tableCols} id="capTable"
            dataSource={doc.rows} scroll={{ y: '50vh' }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有功能点,点「加一行」" /> }} />
        )}
        {mode === 'raw' && (
          <Input.TextArea id="capRaw" rows={18} value={raw} onChange={e => { setRaw(e.target.value); setDirty(true); }}
            style={{ font: "400 12px/1.7 'SF Mono',Menlo,Consolas,monospace" }} />
        )}
      </div>
    </Modal>
  );
}
