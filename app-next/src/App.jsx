// 应用壳:布局与视图切换逐字对应经典 renderMain 的判定
// (空状态 hero / 结果视图 / 任务视图三态;结果页和空状态都收起右栏)。
import React, { useEffect, useState } from 'react';
import { S, ui, bump, boot, publicTaskState, deliveryViewModel, installVisibilityHandler,
         demoBoot, demoNew, isWin } from './core/index.js';
import { useS } from './hooks.js';
import Sidebar from './views/Sidebar.jsx';
import Head from './views/Head.jsx';
import Mid from './views/Mid.jsx';
import Composer from './views/Composer.jsx';
import Rail from './views/Rail.jsx';
import Problem from './views/Problem.jsx';
import NewJob from './views/NewJob.jsx';
import { ConfirmModal, ProjectSheet, LogSheet, DiagnosticSheet, MigratingSheet, Toast } from './ui-bridge.jsx';
import ResultView from './views/ResultView.jsx';
import { CheckSheet, CoverageSheet, RewriteSheet, RedoSheet, PreviewSheet } from './views/sheets.jsx';
import SettingsSheet from './views/SettingsSheet.jsx';
import AssetsSheet from './views/AssetsSheet.jsx';
import UpdateSheet, { UpdateRestart } from './views/UpdateSheet.jsx';
import OnboardingSheet from './views/OnboardingSheet.jsx';
import { renderUpdateSteps, openUpdatePanel, bindUpdateProgress, showUpdateRestart } from './views/update-core.js';
import { njAddFiles, walkEntries, addRef, njOpen } from './views/newjob-core.js';
import Palette, { openPalette } from './views/Palette.jsx';

function Hero({ hidden }){
  // 经典 renderMain 用 display 切换,#hero/#heroSub 常驻 DOM(spec 的反向断言依赖这点)
  return (
    <div id="hero" style={hidden ? { display: 'none' } : undefined}>
      <h2>准备好了,随时开始</h2>
      <div className="hs" id="heroSub">{S.heroSub || '把招标文件交给我,预检 → 分析 → 分章撰写 → 出 Word,全程可对话'}</div>
      <div className="dropbig" onClick={() => document.getElementById('filein') && document.getElementById('filein').click()}>
        <div className="di">↑</div>
        <div><b>上传招标文件,开始生成标书</b><i>点击选择,或把文件拖到窗口任意位置 · docx / pdf / md</i></div>
      </div>
      <div className="sugs">
        <div className="sug" onClick={() => ui.openSheet('assets')}>上传过往标书,自动整理成可复用素材<span className="sgr">素材库</span></div>
        <div className="sug" onClick={() => ui.openSheet('providers')}>接入你的生成服务<span className="sgr">设置</span></div>
        {/* 演示流程全程走本地脚本化通道,不碰引擎——在线时同样放行(经典同注释) */}
        <div className="sug" onClick={() => { S.online ? demoNew('滨江新区智慧管网(演示)') : demoBoot(); }}>先看一遍 12 阶段演示流程<span className="sgr">约 30 秒</span></div>
      </div>
    </div>
  );
}

function DropOverlay({ visible, hot, setHot }){
  if(!visible) return null;
  return (
    <div id="dropzone" style={{ display: 'flex' }}>
      <div className={'dz' + (hot === 'dzNew' ? ' hot' : '')} id="dzNew"
        onDragOver={e => { e.preventDefault(); setHot('dzNew'); }} onDragLeave={() => setHot(null)}>
        <b>作为新任务</b><i>用这份招标文件新开一单</i></div>
      <div className={'dz' + (hot === 'dzRef' ? ' hot' : '')} id="dzRef"
        onDragOver={e => { e.preventDefault(); setHot('dzRef'); }} onDragLeave={() => setHot(null)}>
        <b>加进当前任务</b><i>作为参考资料给 AI 参照写法</i></div>
    </div>
  );
}

export default function App(){
  useS();
  const [dropVisible, setDropVisible] = useState(false);
  const [hot, setHot] = useState(null);

  useEffect(() => {
    // 测试座:经典全局函数名保持可呼(spec 用 page.evaluate 直呼它们)
    window.renderUpdateSteps = renderUpdateSteps;
    window.openUpdatePanel = openUpdatePanel;
    window.showUpdateRestart = showUpdateRestart;
    bindUpdateProgress();
    boot();
    installVisibilityHandler();
    // 运行中的任务每秒刷新耗时/预估(经典同一节奏)
    const clock = setInterval(() => { const p = S.prog[S.active]; if(S.active && p && (p.pct || 0) < 100 && p.step) bump(); }, 1000);
    // 拖放:有当前任务时给出两个明确去处;否则直接当新任务(经典 body 级 drag 处理逐字)
    let dragN = 0;
    const over = e => e.preventDefault();
    const enter = e => { e.preventDefault(); if(++dragN === 1 && S.active) setDropVisible(true); };
    const leave = e => { e.preventDefault(); if(--dragN <= 0){ dragN = 0; setDropVisible(false); setHot(null); } };
    const drop = e => {
      e.preventDefault(); dragN = 0; setDropVisible(false);
      const t = e.target.closest && e.target.closest('.dz');
      const items = e.dataTransfer.items;
      const plainFiles = Array.from(e.dataTransfer.files || []);
      if(S.active && t && t.id === 'dzRef'){ if(plainFiles[0]) addRef(plainFiles[0]); setHot(null); return; }
      setHot(null);
      if(items && items.length && Array.from(items).some(it => { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); return en && en.isDirectory; })){
        walkEntries(Array.from(items), fs => { if(fs.length) njAddFiles(fs); });
      } else if(plainFiles.length){ njAddFiles(plainFiles); }
    };
    // 快捷键:⌘K 命令面板 / ⌘N 新建任务(⌘⏎ 由输入框与弹层各自处理)
    const keys = e => {
      const mod = e.metaKey || e.ctrlKey; if(!mod || e.altKey) return;
      const k = String(e.key || '').toLowerCase();
      if(k === 'k'){ e.preventDefault(); openPalette(); }
      else if(k === 'n' && !e.shiftKey){ e.preventDefault(); openPalette(false); njOpen(); }
    };
    window.addEventListener('keydown', keys);
    document.body.addEventListener('dragover', over);
    document.body.addEventListener('dragenter', enter);
    document.body.addEventListener('dragleave', leave);
    document.body.addEventListener('drop', drop);
    return () => { clearInterval(clock); window.removeEventListener('keydown', keys);
      document.body.removeEventListener('dragover', over); document.body.removeEventListener('dragenter', enter);
      document.body.removeEventListener('dragleave', leave); document.body.removeEventListener('drop', drop); };
  }, []);

  const has = !!S.active;
  const job = has ? S.jobs.find(j => j.job_id === S.active) : null;
  const state = job ? publicTaskState(job) : '';
  const delivery = job ? deliveryViewModel(job, S.arts[S.active] || []) : { primary: null };
  const deliverable = !!(job && delivery.primary && (state === 'completed' || state === 'needs_input'));
  const showResult = deliverable && S.processView[S.active] !== true;
  const railOn = has && !showResult;

  return (
    <>
      {S.demoTag && <div id="demoTag" className="demo-tag" style={{ display: 'block' }}>{S.demoTag}</div>}
      <div id="app" style={{ gridTemplateColumns: railOn ? '246px minmax(0,1fr) 308px' : '246px minmax(0,1fr)' }}>
        <Sidebar />
        <main>
          <Problem />
          <Hero hidden={has} />
          {has && showResult && <ResultView job={job} />}
          {has && !showResult && <><Head /><Mid /><Composer /></>}
        </main>
        {railOn && <Rail />}
      </div>
      <div className="statusbar">
        <span id="sbL">{isWin ? '任务栏显示进度 · 完成后系统通知' : 'Dock 显示进度 · 完成后系统通知 · 托盘常驻'}</span>
        <span className="sbk"> · <kbd>⌘K</kbd>命令面板 <kbd>⌘N</kbd>新建</span>
        <span> · © 2026 张家涛</span><span style={{ flex: 1 }} /><span id="sbR">{S.sbR}</span>
      </div>
      <NewJob />
      <ConfirmModal /><ProjectSheet /><LogSheet /><DiagnosticSheet /><MigratingSheet />
      <CheckSheet /><CoverageSheet /><RewriteSheet /><RedoSheet /><PreviewSheet />
      <SettingsSheet /><AssetsSheet /><UpdateSheet /><OnboardingSheet /><UpdateRestart />
      <Palette />
      <Toast />
      <DropOverlay visible={dropVisible} hot={hot} setHot={setHot} />
    </>
  );
}
