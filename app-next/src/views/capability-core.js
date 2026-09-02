// 产品能力表的纯函数:md 表 ↔ 行数据。表前面的说明文字原样保留,只改表格本身。
export const CAP_COLUMNS = ['功能', '支持情况', '版本要求', '证明材料', '可定制', '配图'];
export const CAP_SUPPORT = ['支持', '部分支持', '不支持', '可定制'];

export function parseCapabilityTable(text){
  const lines = String(text || '').split('\n');
  let headerAt = -1;
  for(let i = 0; i < lines.length; i++){
    const l = lines[i].trim();
    if(l.startsWith('|') && i + 1 < lines.length && /^\|\s*:?-+/.test(lines[i + 1].trim())){ headerAt = i; break; }
  }
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  if(headerAt < 0) return { preamble: String(text || '').trim(), columns: CAP_COLUMNS.slice(), rows: [], tail: '' };
  const columns = cells(lines[headerAt]);
  const rows = [];
  let end = headerAt + 2;
  for(; end < lines.length; end++){
    const l = lines[end].trim();
    if(!l.startsWith('|')) break;
    const c = cells(lines[end]);
    if(c.every(x => !x)) continue;
    rows.push(columns.map((_, k) => c[k] || ''));
  }
  return { preamble: lines.slice(0, headerAt).join('\n').trim(), columns, rows,
           tail: lines.slice(end).join('\n').trim() };
}

export function serializeCapabilityTable({ preamble, columns, rows, tail }){
  const cols = (columns && columns.length ? columns : CAP_COLUMNS);
  const esc = v => String(v == null ? '' : v).replace(/\|/g, '｜').replace(/\n/g, ' ').trim();
  const head = '| ' + cols.map(esc).join(' | ') + ' |\n|' + cols.map(() => '---').join('|') + '|\n';
  const body = (rows || []).filter(r => (r || []).some(v => String(v || '').trim()))
    .map(r => '| ' + cols.map((_, k) => esc((r || [])[k]) || '').join(' | ') + ' |').join('\n');
  return [(preamble || '# 产品能力表').trim(), head + body, (tail || '').trim()].filter(Boolean).join('\n\n') + '\n';
}
