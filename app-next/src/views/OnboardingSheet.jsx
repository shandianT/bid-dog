// 首次运行三步引导:填 Key → 测试连接 → 上传文件。逻辑逐字对应经典 onboarding 五函数。
import React, { useState } from 'react';
import { Modal, Input, Button } from 'antd';
import { S, ui, bump, api, presentProblem, _friendlyText } from '../core/index.js';
import { FORCE_DEMO } from '../core/env.js';

export function setupStep(setup){
  const s=setup||{},raw=String(s.step||s.status||'').toLowerCase();
  if(Number(s.step)>=1&&Number(s.step)<=3)return Number(s.step);
  if(/upload|ready|connected|complete_setup/.test(raw))return 3;
  if(/test|testing|connect/.test(raw))return 2;
  return 1;
}

export async function showOnboarding(force){
  if(FORCE_DEMO||!S.online)return;
  let dismissed=false;try{dismissed=sessionStorage.getItem('bid_onboarding_dismissed')==='1';}catch(_){}
  let step=1;
  try{
    const setup=await api('/v1/setup');S.setup=setup;
    const status=String(setup.status||'').toLowerCase();
    const completed=setup.completed===true||setup.setup_complete===true||setup.complete===true||setup.needs_setup===false||['complete','completed','ready'].indexOf(status)>=0;
    if(completed){try{sessionStorage.setItem('bid_onboarding_dismissed','1');}catch(_){}return;}
    step=setupStep(setup);
    if(dismissed&&!force)return;
  }catch(_){
    /* 旧服务没有 setup 路由时才走兼容判断;新版一律以服务端持久状态为准。 */
    if(!force){
      try{const a=await api('/v1/agent');const configured=!!(a.s2_key_set||a.s2_borrowed||(a.kind&&['mock','s2'].indexOf(a.kind)<0));if(configured||S.jobs.length||dismissed)return;}
      catch(_legacy){return;}
    }
  }
  S.onboardingStep = step;
  S.sheet = { name:'onboarding' }; bump();
}

export async function finishOnboarding(upload){
  try{
    await api('/v1/setup/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({completed:true})});
    try{sessionStorage.setItem('bid_onboarding_dismissed','1');}catch(_){}
    ui.closeAll();
    if(upload!==false){ const fi=document.getElementById('filein'); if(fi) fi.click(); }
  }catch(e){presentProblem({level:'error',title:'初始化状态未能保存',text:'连接已配置，点击重试即可，不需要重新填写 Key。',detail:e&&e.message||'',actions:[{act:'complete_setup',label:'重试保存'}]});}
}

export default function OnboardingSheet(){
  const open = !!(S.sheet && S.sheet.name === 'onboarding');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('等待开始…');
  const [retry, setRetry] = useState(false);
  if(!open) return null;
  const step = S.onboardingStep || 1;
  async function connect(){
    if(!/^sk-\S{8,}/i.test(key.trim())){ ui.toast('请粘贴完整 Key'); return; }
    S.onboardingStep = 2; bump(); setStatus('正在保存推荐配置并测试…'); setRetry(false);
    try{
      const r=await api('/v1/setup/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key.trim(),key:key.trim(),mode:'fast'})});
      if(r&&r.ok===false)throw new Error(r.error||r.message||'连接测试未通过');
      setKey('');S.setup=r;
      setStatus('✓ 连接成功\n✓ 推荐配置已保存\n✓ 可以开始生成真实标书');
      setTimeout(()=>{ S.onboardingStep = 3; bump(); },500);
    }catch(e){
      setStatus('连接没有通过：'+_friendlyText(e&&e.message||'请检查 Key 后重试'));setRetry(true);
      presentProblem({level:'error',title:'连接测试没有通过',text:'请检查 Key 后重试；已填写内容仍在。',detail:e&&e.message||'',actions:[{act:'diagnose',label:'一键诊断'}]});
    }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={480} centered title={null} maskClosable={false}>
      <div className="ob-progress">
        {[1,2,3].map(v => <div key={v} className={'ob-step' + (v===step?' on':'') + (v<step?' done':'')}>{v} · {['填写 Key','测试连接','上传文件'][v-1]}</div>)}
      </div>
      {step === 1 && (
        <div className="ob-pane on">
          <div><div className="ob-big">先连接你的生成服务</div><div className="ob-help">粘贴发放给你的 Key，推荐配置会自动完成。Key 只保存在这台电脑。</div></div>
          <Input.Password id="obKey" autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="粘贴 sk-…" onPressEnter={connect} />
          <div className="ob-help">默认使用极速模式,适合首次试跑;正式定稿可到「设置 · 模型接入」切换标准模式。</div>
          <div className="ob-help">Key 是一串 sk- 开头的密钥,由给你部署中标狗的人发放;没有就找他要一串。Key 只保存在这台电脑。</div>
          <Button type="primary" onClick={connect}>保存并测试</Button>
        </div>
      )}
      {step === 2 && (
        <div className="ob-pane on">
          <div><div className="ob-big">正在测试连接</div><div className="ob-help">通常十几秒完成，请保持窗口打开。</div></div>
          <pre className="diag-status" id="obStatus" style={{ whiteSpace: 'pre-wrap' }}>{status}</pre>
          {retry && <Button type="primary" onClick={connect}>重新测试</Button>}
        </div>
      )}
      {step === 3 && (
        <div className="ob-pane on">
          <div><div className="ob-big">已经可以开始了</div><div className="ob-help">上传招标文件，接着确认模板和项目，系统会自动整理成任务。</div></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" onClick={() => finishOnboarding()}>上传文件</Button>
            <Button onClick={() => finishOnboarding(false)}>稍后再传</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
