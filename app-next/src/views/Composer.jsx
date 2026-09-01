// 输入区:加号菜单(参考资料/新建任务)、回答横幅(ansBar)、输入框、快捷问题。
// send() 的通道选择逐字对应经典:AI 在等回答时走 /answers,否则走 /messages。
import React, { useEffect, useRef, useState } from 'react';
import { Dropdown, Button } from 'antd';
import { Sender, Prompts } from '@ant-design/x';
import { PlusOutlined, PaperClipOutlined, FileAddOutlined } from '@ant-design/icons';
import { S, ui, say, answer } from '../core/index.js';
import { njAddFiles, addRef } from './newjob-core.js';
import { headModel } from './Head.jsx';

export default function Composer(){
  const [draft, setDraft] = useState('');
  const refIn = useRef(null), fileIn = useRef(null);
  const answering = S.active && S.answering[S.active];
  const q = S.active && S.chips[S.active];
  const senderRef = useRef(null);
  useEffect(() => { if(answering && senderRef.current && senderRef.current.focus) senderRef.current.focus(); }, [!!answering]);
  const { delivery, caps } = S.active ? headModel() : { delivery: {}, caps: {} };
  function send(v0){
    const v = String(v0 != null ? v0 : draft).trim(); if(!v) return;
    setDraft('');
    if(S.active && S.answering[S.active]) answer(v); else say(v);
  }
  const menu = {
    items: [
      { key: 'ref', icon: <PaperClipOutlined />, label: <span><b>加参考资料到当前任务</b><br /><i style={{ color: '#8b8f98', fontStyle: 'normal', fontSize: 12 }}>过往标书/模板,AI 写作时参考它的写法</i></span> },
      { key: 'new', icon: <FileAddOutlined />, label: <span><b>新建任务</b><br /><i style={{ color: '#8b8f98', fontStyle: 'normal', fontSize: 12 }}>把这份招标文件作为新任务开始</i></span> },
    ],
    onClick: ({ key }) => {
      if(key === 'new'){ fileIn.current && fileIn.current.click(); return; }
      if(!S.active){ ui.toast('先选中一个任务,参考资料是加给具体任务的'); return; }
      if(!S.online){ ui.toast('未连接本地服务'); return; }
      refIn.current && refIn.current.click();
    },
  };
  const quickItems = (() => {
    const done = !!delivery.complete || (S.active && ['completed','failed'].includes((S.jobs.find(j=>j.job_id===S.active)||{}).state));
    let items = done
      ? [['q', '出件前我还差哪几项?'], ['q', '各章分别写了多少字?'], ['cmd:rerun', '重新生成']]
      : [['q', '现在到哪了?'], ['q', '有哪些废标风险?'], ['cmd:pause', S.paused[S.active] ? '继续生成' : '暂停一下']];
    if(!done && caps && caps.pause === false) items = items.filter(x => x[0] !== 'cmd:pause').concat([['q', '为什么当前不能暂停?']]);
    return items.map(([k, label]) => ({ key: k + '|' + label, description: label }));
  })();
  function onQuick(key){
    const [k, label] = String(key).split('|');
    if(k === 'q') say(label);
    else if(k === 'cmd:pause') togglePause();
    else if(k === 'cmd:rerun') rerunJob();
  }
  return (
    <div className="compose" id="composer">
      <div className="cbox">
        {answering && q ? (
          <div className="ansbar" id="ansBar">
            <span className="adot" /><span className="aq" id="ansQ">{q.text || '回答 AI 的提问'}</span>
            <span className="ax" onClick={() => ui.answerMode(false)}>取消</span>
          </div>
        ) : null}
        {/* Ant Design X:快捷提问用 Prompts,输入用 Sender(自带发送键、组合输入法处理、加载态) */}
        <Prompts wrap className="quick" items={quickItems} onItemClick={info => onQuick(info.data.key)} />
        <Sender ref={senderRef} value={draft} onChange={setDraft} onSubmit={send}
          placeholder={answering ? '把答案打在这里,发出去就回到 AI 那边' : '问问进度、提要求,或把文件拖进来'}
          prefix={
            <Dropdown menu={menu} trigger={['click']} placement="topLeft">
              <Button type="text" size="small" icon={<PlusOutlined />} className="plus" title="添加文件" />
            </Dropdown>
          } />
      </div>
      <input ref={refIn} type="file" id="refin" multiple style={{ display: 'none' }}
        accept=".docx,.doc,.pdf,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.webp"
        onChange={e => { const fs = Array.from(e.target.files); (async () => { for(const f of fs) await addRef(f); })(); e.target.value = ''; }} />
      <input ref={fileIn} type="file" multiple style={{ display: 'none' }}
        onChange={e => { njAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
    </div>
  );
}
