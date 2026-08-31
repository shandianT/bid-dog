// 视图层小工具。esc/mdHtml 逐字对应经典实现(esc 用正则等价替换 DOM 转义,输出一致)。
export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 轻量 Markdown → HTML(先整体转义再变换,内容不可能注入):加粗/标题/有序无序列表/表格/引用/行内代码 */
export function mdHtml(src){
  const lines = esc(src).split('\n');
  const inline = s => s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let out = [], para = [], i = 0;
  const flushP = () => { if(para.length){ out.push('<p>'+para.map(inline).join('<br>')+'</p>'); para = []; } };
  while(i < lines.length){
    const s = lines[i].trim();
    if(!s){ flushP(); i++; continue; }
    let m = s.match(/^(#{1,3})\s+(.*)$/);
    if(m){ flushP(); out.push('<h'+m[1].length+'>'+inline(m[2])+'</h'+m[1].length+'>'); i++; continue; }
    if(/^\|.*\|$/.test(s)){
      flushP(); const tb = [];
      while(i < lines.length && /^\|.*\|$/.test(lines[i].trim())){ tb.push(lines[i].trim()); i++; }
      const rows = tb.filter(r=>!/^\|[\s:|-]+\|$/.test(r))
                     .map(r=>r.replace(/^\||\|$/g,'').split('|').map(c=>inline(c.trim())));
      if(rows.length) out.push('<table><tr>'+rows[0].map(c=>'<th>'+c+'</th>').join('')+'</tr>'
        + rows.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>');
      continue;
    }
    if(/^[-*•]\s+/.test(s)){
      flushP(); const li = [];
      while(i < lines.length && /^[-*•]\s+/.test(lines[i].trim())){ li.push(lines[i].trim().replace(/^[-*•]\s+/,'')); i++; }
      out.push('<ul>'+li.map(x=>'<li>'+inline(x)+'</li>').join('')+'</ul>'); continue;
    }
    if(/^\d{1,3}[.、)]\s+/.test(s)){
      flushP(); const li = [];
      while(i < lines.length && /^\d{1,3}[.、)]\s+/.test(lines[i].trim())){ li.push(lines[i].trim().replace(/^\d{1,3}[.、)]\s+/,'')); i++; }
      out.push('<ol>'+li.map(x=>'<li>'+inline(x)+'</li>').join('')+'</ol>'); continue;
    }
    if(/^&gt;\s?/.test(s)){ flushP(); out.push('<blockquote>'+inline(s.replace(/^&gt;\s?/,''))+'</blockquote>'); i++; continue; }
    if(/^(---+|\*\*\*+)$/.test(s)){ flushP(); i++; continue; }
    para.push(s); i++;
  }
  flushP();
  return '<div class="md">'+out.join('')+'</div>';
}

export const fmtSize = n => n > 1048576 ? (n/1048576).toFixed(1)+' MB' : Math.max(1, Math.round(n/1024))+' KB';
