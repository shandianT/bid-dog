// 设置 · 模型接入:快速接入卡 / 接入点列表 / 高级手动接入 / 生成引擎。
// 结构与全部文案对应经典 #providers 弹层;模型下拉用 AutoComplete 复刻
// bindModelDrop 的规则(过滤到 0 个就回退显示全部,绝不"看起来只有几款")。
import React, { useEffect, useState } from 'react';
import { Modal, Input, Button, Checkbox, Select, AutoComplete } from 'antd';
import { S, ui } from '../core/index.js';
import { P, AG, QK, PROV, QK_MODES, loadProviders, fetchModels, addProvider, testProvider, delProvider,
         onKindChange, testAgent, loadS2Models, provisionShell, saveAgent, queueQkMode, quickS2 } from './settings-core.js';
import { bump } from '../core/store.js';

// 复刻经典 bindModelDrop:聚焦看全部,输入过滤,过滤空则回退全部
function modelOptions(all, typed){
  const list = (all || []);
  if(!typed) return list.map(m => ({ value: m }));
  const q = typed.trim().toLowerCase();
  let hit = list.filter(m => m.toLowerCase().includes(q));
  if(!hit.length) hit = list;
  return hit.slice(0, 300).map(m => ({ value: m }));
}

function ProviderRows(){
  const ps = PROV.list;
  const [testing, setTesting] = useState({});
  if(!ps.length) return (
    <div className="lrow" style={{ borderTop: 'none' }}><span className="dot" style={{ background: '#e5e5ea' }} />
      <div className="c"><span className="n" style={{ color: 'var(--sub)' }}>还没有接入点</span>
        <span className="s">默认已填好 senseaudio 网关,填入 API Key、选好模型,点「添加并测试」</span></div></div>
  );
  return ps.map(p => (
    <div className="lrow" key={p.id}><span className="dot" style={{ background: 'var(--green)' }} />
      <div className="c"><span className="n">{p.name || p.id}</span>
        <span className="s">{(p.base_url || '') + (p.model ? ' · ' + p.model : ' · 未选模型') + (p.vision_model ? ' · 视觉:' + p.vision_model : '')}</span></div>
      <span className="a" onClick={async () => { setTesting(t => ({ ...t, [p.id]: '测试中…' }));
        const ok = await testProvider(p.id); setTesting(t => ({ ...t, [p.id]: ok ? '✓' : '✗' })); }}>{testing[p.id] || '测试'}</span>
      <span className="a" style={{ color: 'var(--red)', marginLeft: 10 }} onClick={() => delProvider(p.id)}>删除</span>
    </div>
  ));
}

export default function SettingsSheet(){
  const open = !!(S.sheet && S.sheet.name === 'providers');
  useEffect(() => { if(open) loadProviders(); }, [open]);
  const [, force] = useState(0);
  const r = () => force(x => x + 1);
  if(!open) return null;
  const showAdv = ['sowork', 'custom', 'claude', 'codex'].includes(AG.kind);
  const kindOptions = [
    { value: 's2', label: '自动(默认)' }, { value: 'mock', label: '内置演示流程' },
    { value: 'sowork', label: 'SoWork(商汤)' }, { value: 'custom', label: '自定义命令' },
    ...AG.extraKinds.map(k => ({ value: k, label: k === 'claude' ? 'Claude Code' : 'Codex CLI' })),
  ];
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={620} centered title="模型接入">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
        <div className="desc2">自有模型填 base_url + key 即可,OpenAI 兼容协议。</div>
        <div className="qkcard">
          <div style={{ font: '600 13.5px/1.4 inherit' }}>⚡ 快速接入(推荐):粘一串 Key,生成 / 对话 / 识图全部配好</div>
          <Input.Password id="qkKey" placeholder="粘贴你收到的 Key(sk-…)" value={QK.key}
            onChange={e => { QK.key = e.target.value; r(); }} />
          <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            <div className="segbar" id="qkMode" style={QK.busy ? { pointerEvents: 'none', opacity: .62 } : undefined}>
              <span className={'seg' + (QK.mode === 'quality' ? ' on' : '')} data-mode="quality" onClick={() => queueQkMode('quality')}>标准(质量优先)</span>
              <span className={'seg' + (QK.mode === 'fast' ? ' on' : '')} data-mode="fast" onClick={() => queueQkMode('fast')}>极速(默认)</span>
            </div>
            <span style={{ flex: 1 }} />
            <Button type="primary" id="qkBtn" loading={QK.busy} onClick={quickS2}>一键接入并测试</Button>
          </div>
          <div id="qkModeHint" style={{ font: '400 11.5px/1.6 inherit', color: 'var(--dim)' }}>{QK_MODES[QK.mode].hint}</div>
          {QK.now && <div id="qkNow" style={{ font: '500 11.5px/1.6 inherit', color: QK.nowColor }}>{QK.now}</div>}
          {QK.msg && <div id="qkMsg" style={{ font: '400 12.5px/1.8 inherit', color: 'var(--sub)', whiteSpace: 'pre-line' }}>{QK.msg}</div>}
        </div>
        <div id="pList"><ProviderRows /></div>
        <details className="setdet">
          <summary>高级 · 手动接入其他网关(一般用不到)</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 8 }}>
            <Input placeholder="名称" value={P.name} onChange={e => { P.name = e.target.value; r(); }} />
            <Input placeholder="Base URL" value={P.url} onChange={e => { P.url = e.target.value; r(); }} />
            <Input.Password placeholder="API Key(sk-…)" value={P.key} onChange={e => { P.key = e.target.value; r(); }} />
            <div style={{ display: 'flex', gap: 9 }}>
              <AutoComplete style={{ flex: 1 }} value={P.model} options={modelOptions(S.models, P.model)}
                onChange={v => { P.model = v; r(); }} placeholder="模型 ID,如 senseaudio-s2" />
              <Button onClick={fetchModels}>获取模型列表</Button>
            </div>
            <AutoComplete value={P.vision} options={modelOptions(S.models, P.vision)}
              onChange={v => { P.vision = v; r(); }} placeholder="视觉模型(选填,用于图片 OCR 打标,如 senseaudio-vl-1.0-260319)" />
            <Checkbox checked={P.insecure} onChange={e => { P.insecure = e.target.checked; r(); }}>
              跳过 HTTPS 证书校验(仅用于内网自签名网关或公司代理拦截时)</Checkbox>
            {P.msg && <div id="pMsg" style={{ font: '400 12.5px/1.7 inherit', color: 'var(--sub)', whiteSpace: 'pre-line' }}>{P.msg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button type="primary" onClick={addProvider}>添加并测试</Button></div>
          </div>
        </details>
        <details className="setdet">
          <summary id="engSum">{AG.engSum}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <Select style={{ flex: 1 }} value={AG.kind} options={kindOptions}
                onChange={v => { AG.kind = v; onKindChange(); }} />
              <Button onClick={testAgent}>测试连接</Button>
              <Button type="primary" onClick={() => saveAgent()}>保存</Button>
            </div>
            {AG.kind === 's2' && (
              <>
                <div className="s2note"><b>填了 Key 就产真实标书,没填就跑内置演示流程</b>——不用你判断该选哪个。不需要 Claude/Codex 账号,也不需要登录其他服务,所需生成组件已内置。<br />Key 由中标狗提供方发放,额度记在发放方的套餐上——没有的话找他要一串。</div>
                <Input.Password placeholder="API Key(你收到的 sk-… ;留空=沿用已保存的,或借用上面「模型接入」里的 Key)"
                  value={AG.s2Key} onChange={e => { AG.s2Key = e.target.value; r(); }} />
                <div style={{ display: 'flex', gap: 9 }}>
                  <Input style={{ flex: 2 }} placeholder={AG.s2BasePh} value={AG.s2Base} onChange={e => { AG.s2Base = e.target.value; r(); }} />
                  <AutoComplete style={{ flex: 1.4 }} value={AG.s2Model} options={modelOptions(S.s2Models, AG.s2Model)}
                    onChange={v => { AG.s2Model = v; r(); }} placeholder={AG.s2ModelPh} />
                  <Button onClick={() => loadS2Models(1)}>取模型</Button>
                </div>
                {AG.s2Hint && <div style={{ font: '400 11.5px/1.6 inherit', color: AG.s2HintColor, wordBreak: 'break-all' }}>{AG.s2Hint}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, font: '400 11.5px/1.6 inherit' }}>
                  <span style={{ flex: 1, color: AG.shellStColor }}>{AG.shellSt}</span>
                  {AG.shellInstall && <Button size="small" disabled={AG.shellBusy} onClick={provisionShell}>{AG.shellInstallText}</Button>}
                </div>
              </>
            )}
            {AG.kind === 'custom' && <Input placeholder={AG.cmdPh} value={AG.cmd} onChange={e => { AG.cmd = e.target.value; r(); }} />}
            {showAdv && (
              <>
                <Input placeholder="CLI 路径(留空=自动查找;SoWork 通常在 /Applications/…SoWork.app/Contents/Resources/cli/openclaw)"
                  value={AG.cli} onChange={e => { AG.cli = e.target.value; r(); }} />
                {AG.cliHint && <div style={{ font: '400 11.5px/1.6 inherit', color: AG.cliHintColor, marginTop: -4, wordBreak: 'break-all' }}>{AG.cliHint}</div>}
                <div style={{ display: 'flex', gap: 9 }}>
                  <Select style={{ flex: 1 }} value={AG.think} onChange={v => { AG.think = v; r(); }}
                    options={[{ value: 'off', label: '思考等级:off(SenseAudio-S2 只支持这个)' },
                      { value: 'medium', label: '思考等级:medium' }, { value: 'high', label: '思考等级:high' }]} />
                  <Input style={{ flex: 1 }} placeholder="agent 名(默认 main)" value={AG.soworkAgent} onChange={e => { AG.soworkAgent = e.target.value; r(); }} />
                </div>
                <Checkbox checked={AG.loginShell} onChange={e => { AG.loginShell = e.target.checked; r(); }}>
                  用登录 shell 启动(双击打开的应用拿不到终端环境变量,勾上才能连到本机网关)</Checkbox>
                <Input placeholder={AG.envPh} value={AG.env} onChange={e => { AG.env = e.target.value; r(); }} />
              </>
            )}
            {AG.testMsg && <div id="agTestMsg" style={{ font: '400 12.5px/1.7 inherit', color: 'var(--sub)', whiteSpace: 'pre-line' }}>{AG.testMsg}</div>}
            {AG.msg && <div id="agMsg" style={{ font: '400 12px/1.7 inherit', color: 'var(--faint)' }}>{AG.msg}</div>}
          </div>
        </details>
        <div style={{ font: '400 11.5px/1.7 inherit', color: 'var(--faint)' }}>Key 存本地引擎配置(生产版转系统钥匙串)。sowork / workbuddy 等平台内使用见 docs/使用与绑定指南.md。</div>
        <div style={{ font: '400 11.5px/1.7 inherit', color: 'var(--faint)' }}>作者：FDE 家涛</div>
      </div>
    </Modal>
  );
}
