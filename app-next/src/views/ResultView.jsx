// 交付结果主视图:逐字对应经典 renderResult(warn/ok 双态、已保住的过程文件、
// 三项交付检查、用量四格),按钮接真实 openArtifact/downloadResultWord。
import React from 'react';
import { S, ui, bump, deliveryViewModel, publicTaskState, taskPresentation, _shortDuration } from '../core/index.js';
import { openArtifact, downloadResultWord } from './artifacts.js';

function checkRow(label, item){
  const x = item || { state: 'unknown', detail: '尚未检查' };
  const icon = { pass: '✓', warn: '!', fail: '×', unknown: '?' }[x.state] || '?';
  return (
    <div className={'result-check ' + (x.state || 'unknown')} key={label}>
      <span className="ci">{icon}</span><strong>{label}</strong><span>{x.detail || '尚未检查'}</span>
    </div>
  );
}
const usageValue = (value, fallback) => value == null || value === '' ? (fallback || '—') : value;

export default function ResultView({ job }){
  if(!job || !S.active) return null;
  const vm = deliveryViewModel(job, S.arts[S.active] || []), state = publicTaskState(job), p = taskPresentation(job);
  const waiting = state === 'needs_input';
  const word = vm.primary;
  const kb = word && (word.size_kb || (word.size ? Math.round(Number(word.size) / 1024) : 0));
  const saved = (S.arts[S.active] || []).length;
  const meta = word ? ('Word 文档' + (kb ? ' · ' + kb + ' KB' : '') + ' · 请人工复核后提交')
    : (saved ? ('已保住 ' + saved + ' 个过程文件(点「打开任务文件夹」可查看);最终 Word 尚未生成,可「从断点继续」') : '请到过程与诊断查看中断原因');
  const u = job.usage || (job.presentation && job.presentation.usage) || (job.delivery && job.delivery.usage) || {};
  const elapsed = job.elapsed_seconds != null ? job.elapsed_seconds : (job.elapsed != null ? job.elapsed : u.elapsed_seconds);
  const calls = u.calls != null ? u.calls : (u.request_count != null ? u.request_count : u.requests);
  const tokens = u.total_tokens != null ? u.total_tokens : ((Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0) || null);
  const cost = u.estimated_cost != null ? u.estimated_cost : u.cost;
  const currency = String(u.currency || 'USD').toUpperCase();
  const costText = cost == null ? '—' : ((currency === 'CNY' || currency === 'RMB' ? '¥' : '$') + Number(cost).toFixed(Number(cost) < 1 ? 3 : 2));
  const usage = [
    ['用时', elapsed != null ? _shortDuration(elapsed) : '—'], ['调用次数', usageValue(calls)],
    ['总用量', tokens != null ? Number(tokens).toLocaleString() + ' tokens' : '—'], ['预估费用', costText],
  ];
  return (
    <div className="result-view" id="resultView">
      <div className="result-wrap">
        <div className="result-nav"><button className="tab on" type="button">交付结果</button>
          <button className="tab" type="button" onClick={() => { S.processView[S.active] = true; bump(); }}>过程与诊断</button></div>
        <div className="result-hero">
          <div className={'result-mark' + (waiting ? ' warn' : '')}>{waiting ? '!' : '✓'}</div>
          <div className="result-title">
            <h2>{waiting ? '文件已生成，还有事项需要你确认' : '交付文件已准备好'}</h2>
            <p>{p.currentAction} · 最后活动 {p.lastActivity}</p>
          </div>
        </div>
        <div className="result-shell">
          <section className="result-card">
            <div className="lbl2">主交付文件</div>
            <div className="result-word">
              <div className="word-icon">WORD</div>
              <div className="word-copy"><b id="resultWordName">{word ? (word.name || '投标文件.docx') : '尚未找到可交付 Word'}</b><span>{meta}</span></div>
            </div>
            <div className="result-actions">
              <button className="primary" type="button" disabled={!word} onClick={() => word && openArtifact(word.name || '投标文件.docx', word.url || '')}>打开</button>
              <button type="button" disabled={!word} onClick={downloadResultWord}>下载</button>
              <button type="button" disabled={!word} onClick={() => ui.openRevision()}>继续修改</button>
            </div>
            <div className="result-note">提交前仍请人工确认投标人名称、报价、资质有效期和签章。</div>
          </section>
          <section className="result-card">
            <div className="lbl2">交付检查</div>
            <div className="result-checks" id="resultChecks">
              {checkRow('目录完整性', vm.toc)}{checkRow('偏离表', vm.deviations)}{checkRow('内容质量', vm.quality)}
            </div>
            <div className="result-actions">
              <button type="button" onClick={() => ui.openCheck()}>查看待确认项</button>
              <button type="button" onClick={() => { S.processView[S.active] = true; bump(); }}>查看过程</button>
            </div>
          </section>
        </div>
        <section className="result-card">
          <div className="lbl2">本次用量</div>
          <div className="usage-grid" id="resultUsage">
            {usage.map(x => <div className="usage-item" key={x[0]}><b>{x[1]}</b><span>{x[0]}</span></div>)}
          </div>
        </section>
      </div>
    </div>
  );
}
