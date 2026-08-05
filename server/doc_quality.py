#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
标书内容质量门禁与修复
- detect(text) 检测生成退化:正文被逐字打散、同一段落重复灌注
- repair(text) 把逐字碎片合并回段落、折叠重复样板,救回可用文稿
单独使用:python3 doc_quality.py <文件.md|文件.docx> [--fix 输出.md]
"""
import re, sys, collections

SHORT = 4            # ≤3 个字符视为"碎片段落"
REPEAT_LIMIT = 8     # 同一段落重复超过该次数视为异常灌注
SHORT_RATIO = 0.15   # 碎片段落占比超过该比例视为逐字打散

def _lines(text):
    return [l.rstrip() for l in text.splitlines()]

def detect(text):
    ls = [l.strip() for l in _lines(text)]
    body = [l for l in ls if l and not l.startswith(('#', '|', '>', '-', '*', '```'))]
    if not body: return {'ok': True, 'issues': []}
    short = [l for l in body if len(l) < SHORT]
    cnt = collections.Counter(l for l in body if len(l) >= 12)   # 短样板反复灌注也要拦
    top, times = (cnt.most_common(1)[0] if cnt else ('', 0))
    ratio = len(short) / len(body)
    issues = []
    if ratio > SHORT_RATIO:
        issues.append({'level': 'red', 'code': 'char_split',
                       'title': '正文被逐字打散(%d/%d 段只有 1~3 个字)' % (len(short), len(body)),
                       'detail': '生成阶段把整段文字拆成了一个字一段,交付前必须修复'})
    if times > REPEAT_LIMIT:
        issues.append({'level': 'red', 'code': 'repeat',
                       'title': '同一段落重复 %d 次' % times,
                       'detail': '重复内容:%s…' % top[:40]})
    return {'ok': not issues, 'issues': issues,
            'stats': {'paragraphs': len(body), 'short': len(short), 'max_repeat': times}}

def repair(text):
    """合并逐字碎片 + 折叠重复样板(标题/表格/列表原样保留)"""
    out, buf = [], []
    cnt = collections.Counter(l.strip() for l in _lines(text) if len(l.strip()) >= 12)
    dup = {t for t, n in cnt.items() if n > REPEAT_LIMIT}   # 被反复灌注的样板
    seen_dup = set()
    def flush():
        if buf:
            out.append(''.join(buf)); buf.clear()
    for raw in _lines(text):
        s = raw.strip()
        if not s:
            if buf: continue          # 碎片之间的空行要跳过,否则每个字各自成段、合并不起来
            out.append(''); continue
        if s.startswith(('#', '|', '>', '-', '*', '```', '!')) or re.match(r'^\d+[.、]', s):
            flush(); out.append(raw); continue
        if s in dup:                       # 重复样板:每章只保留第一次
            key = (len([o for o in out if o.startswith('#')]), s)
            if key in seen_dup:
                continue                   # 丢弃时不冲缓冲区,否则夹在碎片中间会打断合并
            seen_dup.add(key); flush(); out.append(s); continue
        if len(s) < SHORT:                 # 碎片:攒起来拼回整段
            buf.append(s); continue
        flush(); out.append(raw)
    flush()
    # 压掉多余空行
    res, blank = [], 0
    for l in out:
        if l == '':
            blank += 1
            if blank > 1: continue
        else: blank = 0
        res.append(l)
    return '\n'.join(res).strip() + '\n'

def read_any(path):
    if path.lower().endswith('.docx'):
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        from docx.oxml.ns import qn
        doc = Document(path); out = []
        for child in doc.element.body.iterchildren():
            if child.tag == qn('w:p'):
                p = Paragraph(child, doc); t = p.text.strip()
                if not t: continue
                st = (p.style.name or '').lower()
                lv = 0
                if 'heading 1' in st or st == '标题 1': lv = 1
                elif 'heading 2' in st or st == '标题 2': lv = 2
                elif 'heading' in st or st.startswith('标题'): lv = 3
                out.append(('#' * lv + ' ' if lv else '') + t)
            elif child.tag == qn('w:tbl'):
                tb = Table(child, doc)
                rows = ['| ' + ' | '.join(' '.join(c.text.split()) for c in r.cells) + ' |' for r in tb.rows]
                if rows:
                    rows.insert(1, '|' + '---|' * len(tb.rows[0].cells))
                    out.append('\n'.join(rows))
        return '\n\n'.join(out)
    return open(path, encoding='utf-8', errors='ignore').read()

if __name__ == '__main__':
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    src = read_any(sys.argv[1])
    r = detect(src)
    print('检测:', '✅ 未发现异常' if r['ok'] else '❌ 发现 %d 类问题' % len(r['issues']))
    for i in r['issues']: print('  -', i['title'], '|', i['detail'])
    print('  统计:', r.get('stats'))
    if '--fix' in sys.argv:
        dst = sys.argv[sys.argv.index('--fix') + 1]
        fixed = repair(src)
        open(dst, 'w', encoding='utf-8').write(fixed)
        after = detect(fixed)
        print('已修复 →', dst, '| 修复后:', '✅ 正常' if after['ok'] else '仍有问题', after.get('stats'))
