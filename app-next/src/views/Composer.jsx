// 输入区:加号菜单(参考资料/新建任务)、回答横幅(ansBar)、输入框、快捷问题。
// send() 的通道选择逐字对应经典:AI 在等回答时走 /answers,否则走 /messages。
import React, { useEffect, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { PlusOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { S, ui, say, answer } from '../core/index.js';
import { njAddFiles, addRef } from './newjob-core.js';
import { Quick, headModel } from './Head.jsx';

export default function Composer(){
  const [draft, setDraft] = useState('');
  const refIn = useRef(null), fileIn = useRef(null);
  const answering = S.active && S.answering[S.active];
  const q = S.active && S.chips[S.active];
  const draftRef = useRef(null);
  useEffect(() => { if(answering && draftRef.current) draftRef.current.focus(); }, [!!answering]);
  const { delivery, caps } = S.active ? headModel() : { delivery: {}, caps: {} };
  function send(){
    const v = draft.trim(); if(!v) return;
    setDraft('');
    if(S.active && S.answering[S.active]) answer(v); else say(v);
  }
  const menu = {
    items: [
      { key: 'ref', label: <span><b>加参考资料到当前任务</b><br /><i style={{ color: '#8b8f98', fontStyle: 'normal', fontSize: 12 }}>过往标书/模板,AI 写作时参考它的写法</i></span> },
      { key: 'new', label: <span><b>新建任务</b><br /><i style={{ color: '#8b8f98', fontStyle: 'normal', fontSize: 12 }}>把这份招标文件作为新任务开始</i></span> },
    ],
    onClick: ({ key }) => {
      if(key === 'new'){ fileIn.current && fileIn.current.click(); return; }
      if(!S.active){ ui.toast('先选中一个任务,参考资料是加给具体任务的'); return; }
      if(!S.online){ ui.toast('未连接本地服务'); return; }
      refIn.current && refIn.current.click();
    },
  };
  return (
    <div className="compose" id="composer">
      <div className="cbox">
        {answering && q ? (
          <div className="ansbar" id="ansBar">
            <span className="adot" /><span className="aq" id="ansQ">{q.text || '回答 AI 的提问'}</span>
            <span className="ax" onClick={() => ui.answerMode(false)}>取消</span>
          </div>
        ) : null}
        <div className="inbar">
          <Dropdown menu={menu} trigger={['click']} placement="topLeft">
            <span className="plus" title="添加文件"><PlusOutlined /></span>
          </Dropdown>
          <input id="draft" ref={draftRef} value={draft}
            placeholder={answering ? '把答案打在这里,发出去就回到 AI 那边' : '问问进度、提要求,或把文件拖进来'}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if(e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
          <span className="rbtn send" onClick={send}><ArrowUpOutlined style={{ fontSize: 14 }} /></span>
        </div>
        <Quick done={!!delivery.complete || (S.active && ['completed','failed'].includes((S.jobs.find(j=>j.job_id===S.active)||{}).state))} caps={caps} />
      </div>
      <input ref={refIn} type="file" id="refin" multiple style={{ display: 'none' }}
        accept=".docx,.doc,.pdf,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.webp"
        onChange={e => { const fs = Array.from(e.target.files); (async () => { for(const f of fs) await addRef(f); })(); e.target.value = ''; }} />
      <input ref={fileIn} type="file" multiple style={{ display: 'none' }}
        onChange={e => { njAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
    </div>
  );
}
