// 诊断包导出:逐字对应经典 downloadDiagnosticBundle(桌面走引擎保存并定位;网页走下载)。
import { S, ui, api } from '../core/index.js';
import { IS_WEB, net } from '../core/env.js';

export async function downloadDiagnosticBundle(){
  if(!S.active || !S.online){ ui.toast('本地服务未连接，暂时不能导出诊断包'); return; }
  ui.toast('正在整理诊断包…');
  if(!IS_WEB){
    try{
      const saved = await api('/v1/jobs/'+encodeURIComponent(S.active)+'/bundle/save', {method:'POST'});
      ui.toast('诊断包已保存并定位:'+(saved.name||'诊断包.zip'));
    }catch(e){ ui.toast('诊断包导出失败:'+(e&&e.message||'请更新应用后重试')); }
    return;
  }
  try{
    const url = net.API.replace(/\/$/,'') + '/v1/jobs/' + encodeURIComponent(S.active) + '/bundle';
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok){
      let why = ''; try{ const b=await r.json(); why=b.error||b.detail||''; }catch(_){}
      throw new Error(why || ('HTTP '+r.status));
    }
    const blob = await r.blob(), cd = r.headers.get('content-disposition') || '';
    let name = '中标狗_诊断包_' + String(S.active).replace(/[^\w一-鿿.-]+/g,'_') + '.zip';
    const utf = cd.match(/filename\*=UTF-8''([^;]+)/i), plain = cd.match(/filename="?([^";]+)"?/i);
    try{ if(utf) name = decodeURIComponent(utf[1]); else if(plain) name = plain[1]; }catch(_){}
    const a = document.createElement('a'), objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl), 1500);
    ui.toast('诊断包已导出');
  }catch(e){ ui.toast('诊断包导出失败:'+(e&&e.message||'请更新应用后重试')); }
}
