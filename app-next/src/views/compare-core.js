// 对照阅读器的纯函数:评分点 → 关键词,关键词 → 命中行。不碰 DOM,core-smoke 单测。
export function compareTerms(text){
  const raw = String(text || '').replace(/[\d.]+\s*分/g, ' ')
    .replace(/[（()）【】\[\]〔〕「」《》,，;；:：、。\s|｜/\-—_]+/g, ' ').trim();
  const pieces = raw.split(' ').filter(p => p.length >= 2);
  const terms = new Set();
  pieces.forEach(p => {
    if(p.length <= 6) terms.add(p);
    for(let n = Math.min(4, p.length); n >= 2; n--) for(let i = 0; i + n <= p.length; i++) terms.add(p.slice(i, i + n));
  });
  return [...terms].filter(t => /[一-鿿A-Za-z0-9]{2,}/.test(t)).sort((a, b) => b.length - a.length).slice(0, 24);
}
// 标题行按 0.5 计分、同分时正文优先:要跳到的是「答了什么」的那一段,不是章标题本身
export function compareHits(lines, terms){
  const scored = [];
  (lines || []).forEach((line, i) => {
    let score = 0;
    for(const t of terms) if(line.includes(t)) score += t.length;
    if(!score) return;
    const heading = /^#{1,6}\s/.test(line) ? 1 : 0;
    scored.push({ i, score: heading ? score * 0.5 : score, heading });
  });
  return scored.sort((a, b) => b.score - a.score || a.heading - b.heading || a.i - b.i);
}
