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

# —— 段内复读(模型退化循环)——
# 上面两条查的都是「段与段之间」的异常。但模型卡进复读循环时,整个循环往往落在
# **同一段**里:一线实测的一份 0.21.0 成品,第五章开头是
#   「招标文件第 5 机构。 项目管理机构。 5 章节。 5 章节。 5 章节。…」
# 「5 章节」连着重复 946 遍、整段 5781 字,而 Counter 只把它数成 1 段,
# max_repeat=1,门禁一路放行,最后进了交给客户的 Word。
# 更糟的是 min_chars 这类长度门槛反而在奖励复读:卡住的模型字数从来不缺。
LOOP_MIN_CHARS = 1200    # 只查长段:短复读本来就会被 min_chars 这类长度门槛拦下,
                         # 复读门禁存在的理由恰恰是「长度门槛反过来奖励长复读」。
                         # 一线那份实测是 5781 字的复读,离这条线很远。
LOOP_MIN_UNITS = 12      # 段内至少切出这么多小句才谈得上「循环」
LOOP_MIN_TIMES = 8       # 同一小句在段内重复的次数下限
LOOP_MIN_SHARE = 0.5     # 且它得占到段内小句的一半以上
LOOP_NGRAM = 6           # 无标点复读的兜底:6-gram 去重后剩得太少即为退化
LOOP_NGRAM_CHARS = 400
LOOP_NGRAM_RATIO = 0.06

_UNIT_SPLIT = re.compile(r'[。；;！!？?\n]+')

def degenerate_span(line):
    """段内复读检测。返回 (复读单元, 次数, 占比) 或 None。

    只对长段生效,并且要求「同一小句既重复够多次、又占了这段的一半以上」——
    一句话里出现两三次相同措辞是正常写法,不能算退化。"""
    s = (line or '').strip()
    if len(s) < LOOP_MIN_CHARS:
        return None
    units = [u.strip() for u in _UNIT_SPLIT.split(s) if u.strip()]
    if len(units) >= LOOP_MIN_UNITS:
        unit, times = collections.Counter(units).most_common(1)[0]
        share = times / len(units)
        if times >= LOOP_MIN_TIMES and share >= LOOP_MIN_SHARE:
            return (unit, times, share)
    # 兜底:整段没有句读的复读(「安全安全安全…」),看 n-gram 的多样性
    if len(s) >= LOOP_NGRAM_CHARS:
        grams = [s[i:i + LOOP_NGRAM] for i in range(len(s) - LOOP_NGRAM + 1)]
        if grams and len(set(grams)) / len(grams) < LOOP_NGRAM_RATIO:
            top, times = collections.Counter(grams).most_common(1)[0]
            return (top, times, len(set(grams)) / len(grams))
    return None

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
    # 复读循环要在**所有**行上查,不能只查 body:一线那份成品里,整段 5783 字的复读
    # 恰恰挂在章标题的样式上,read_any 给它加了 '#',按 body 过滤反而正好把它藏了起来。
    # 表格行排除在外——偏离表里同一列反复出现「无偏离」是正常的。
    scan = [l for l in ls if l and not l.startswith('|')]
    loops = [(l, d) for l in scan for d in [degenerate_span(l)] if d]
    if loops:
        worst = max(loops, key=lambda x: x[1][1])
        unit, ltimes, _share = worst[1]
        issues.append({'level': 'red', 'code': 'loop',
                       'title': '同一段里复读 %d 遍「%s」' % (ltimes, unit[:16]),
                       'detail': '模型在这一段卡进了复读循环,这一段没有真正写出内容;'
                                 '清洗只能把复读折掉,该章需要重写'})
    return {'ok': not issues, 'issues': issues,
            'stats': {'paragraphs': len(body), 'short': len(short),
                      'max_repeat': times, 'loops': len(loops)}}

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
        if not s.startswith('|'):          # 表格行不动:偏离表里同列反复「无偏离」是正常的
            loop = degenerate_span(s)      # 段内复读:折成一遍(标题行也要折,复读常挂在标题上)
            if loop:
                flush(); out.append(_collapse_loop(raw, loop[0])); continue
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

def _collapse_loop(raw, unit):
    """把段内复读折成一遍:保留原有顺序,复读单元只留第一次出现。

    折完这一段仍然是个残句——本来就该是。清洗只保证 Word 不再是几百遍复读,
    「这一章没写出内容」这件事由 detect() 的红灯和「重做这一章」负责,不能被折没了。"""
    prefix = raw[:len(raw) - len(raw.lstrip())]
    units, seen, kept = _UNIT_SPLIT.split(raw.strip()), False, []
    for u in units:
        t = u.strip()
        if not t:
            continue
        if t == unit:
            if seen:
                continue
            seen = True
        kept.append(t)
    return prefix + '。'.join(kept) + '。'


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
                # WPS/.doc 转存的 docx 里 p.style 常为 None,直接 .name 会把整个解析打崩
                # (engine_v1._style_name 同一坑已修,这里同样要防)
                try:
                    st = ((p.style.name if p.style is not None else '') or '').lower()
                except Exception:
                    st = ''
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
