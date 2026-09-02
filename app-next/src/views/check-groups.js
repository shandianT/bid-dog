// 出件前检查的分组(纯函数):必办 / 建议 / 已通过,每组给一个主动作。
// 以前一张平铺清单里混着「重做这一章」「打开报告」「定向重做」三类动作,用户得自己分辨哪条不改不能投。
export function checkGroups(gaps){
  const list = Array.isArray(gaps) ? gaps : [];
  const red = list.filter(g => g && g.level === 'red');
  const green = list.filter(g => g && g.level === 'green');
  const yellow = list.filter(g => g && g.level !== 'red' && g.level !== 'green');
  const has = (items, act) => items.some(g => (g.actions || []).some(a => a.act === act));
  const primaryOf = (items, key) => {
    if(!items.length) return null;
    if(key === 'red'){
      if(has(items, 'redo') || has(items, 'open_redo')) return { act: 'open_redo', label: '定向重做不达标章节' };
      if(has(items, 'export_docx')) return { act: 'export_docx', label: '立即补出 Word' };
      if(has(items, 'resume')) return { act: 'resume', label: '从断点继续' };
    }
    const art = items.flatMap(g => g.actions || []).find(a => a.act === 'open_artifact' && a.file);
    if(art) return { act: 'open_artifact', file: art.file, label: '打开' + String(art.file).replace(/\.md$/i, '') };
    return null;
  };
  return [
    { key: 'red', label: '必办', color: 'error', hint: '不改不能投', items: red, primary: primaryOf(red, 'red') },
    { key: 'yellow', label: '建议', color: 'warning', hint: '改了更好,不改也能提交', items: yellow, primary: primaryOf(yellow, 'yellow') },
    { key: 'green', label: '已通过', color: 'success', hint: '', items: green, primary: null },
  ].filter(g => g.items.length);
}
