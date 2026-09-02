# -*- coding: utf-8 -*-
"""章节撰写契约:流水线里每个论述章节点的 system 提示。

为什么单独成文件:以前章节节点的 system 是把多 agent 版 SKILL.md 用关键词正则压到 6000 字
的零散句子——模型拿到的是一堆「必须/不得」开头的碎片,而 SKILL.md 里被真实事故倒逼出来的
纪律(小标题按本章现拟、不跨章复用、表格装真内容、配图只证明响应、资质整块留位)反而被
切碎了。这里写成一份结构化、不到 1500 字的契约,并把「其他章已用过的小标题」传进去。

篇幅线也统一在这里:以前提示词说 2500、OpenCode 路径说 800、质检黄线 3500——三处三个数。
"""
import re

CHAPTER_TARGET_CHARS = 3500       # 论述章篇幅线:提示词与成品质检黄线同一个数(红线 2000 在技能包 quality_gate.py)
CHAPTER_MAX_USED_HEADINGS = 60    # 传给撰写员的「已用小标题」上限,再多就是噪音
CHAPTER_CONTRACT_MAX_CHARS = 1500

_HEADING_RX = re.compile(r'^\s{0,3}#{2,3}\s+(.+?)\s*#*\s*$')
# 去掉「1.1 」「二、」「(一)」「3) 」这类多级编号;「5G 网络」这种数字后面紧跟字母的不动
_NUMBERING_RX = re.compile(r'^\s*[(（]?(?:(?:[\d一二三四五六七八九十]+[.、．)）])+[\d一二三四五六七八九十]*\s*|[\d一二三四五六七八九十]+\s+)')


def used_headings_from_text(text, limit=CHAPTER_MAX_USED_HEADINGS):
    """从一章正文里取 H2/H3 小标题(去重、保序、去掉编号前缀)。"""
    out = []
    for line in str(text or '').splitlines():
        m = _HEADING_RX.match(line)
        if not m: continue
        title = _NUMBERING_RX.sub('', m.group(1)).strip()
        if title and title not in out:
            out.append(title)
        if len(out) >= limit: break
    return out


def chapter_contract(title, used_headings=(), target_chars=CHAPTER_TARGET_CHARS):
    """论述章的 system 契约。used_headings 是其他章已经用过的小标题,本章不得重复。"""
    used = [str(h).strip() for h in (used_headings or []) if str(h).strip()][:CHAPTER_MAX_USED_HEADINGS]
    used_line = ('其他章节已用过的小标题:%s;本章不得重复其中任何一条。' % '、'.join(used)) if used else \
                '本章是第一个写的论述章,小标题仍须来自本章内容,不得写成通用模板词。'
    return (
        '你是中标狗的章节撰写员,只写章节「%s」这一份 Markdown 文件。\n\n'
        '【事实边界】\n'
        '- 我方(投标人)的身份、资质、案例、人员、报价、财务:只取自「素材」目录里的文件;没有的写〔需补充〕并中性成句,严禁编造。\n'
        '- 采购人一律写〔采购人〕;只依据招标文件解析版,不引用不存在的章节。\n'
        '- AI 给出的具体数字标〔参数待核实〕;招标文件原文高于模板与个人习惯。\n\n'
        '【小标题】\n'
        '- H1 只有一个:章节标题原文。小标题(H2/H3)必须依据本章自己的内容现拟,不得套用「实施方法论/关键技术细节/交付物/风险应对」这类通用词直接当标题。\n'
        '- %s\n'
        '- 两章小标题撞车 = 这一章重写。\n\n'
        '【正文】\n'
        '- 逐条响应分配到本章的招标要求与评分点:每一条都要有对应的段落或表格行,并注明依据(条款号或原文摘要)。\n'
        '- 每段都要有具体信息:做法、步骤、参数、时间、责任人、验收口径;写不出具体内容就明说素材不够并标〔需补充〕,不用空话填。\n'
        '- 篇幅按招标文件的分量走,论述章正文不少于 %d 个中文字符;格式件、表单、证明件本来就短,不得为凑字数灌内容。\n'
        '- 严禁把一句话拆成一行一个字,严禁同一段落反复重复;同一小句连着出现两次以上就是写坏了。\n\n'
        '【表格与配图】\n'
        '- 表格必须装本章自己的真实内容,列名按具体用途命名;禁止「信息项｜内容」这类泛化表头,禁止全书共用一个表头反复出现。\n'
        '- 配图只做一件事:证明我方对某条技术要求或评分点的响应。有《图片索引》时独立成行写 {{图:图片ID}}(ID 只能用索引里登记的);没有就写〔配图建议:说明〕。\n'
        '- 人员资质、合同页、证照、业绩证明一律不插图:按招标规定的名称留一个整块粘贴位,写〔此处粘贴:…〕。\n\n'
        '【输出】\n'
        '- 只返回本章完整 Markdown 正文,不要 JSON、代码围栏或解释;不写内部 ID、自评或 ⚠️。'
        % (str(title or '本章'), used_line, int(target_chars))
    )


def chapter_task(node, target_chars=CHAPTER_TARGET_CHARS):
    """论述章的 user 任务行:本章依据 / 评分点 / 素材槽位 / 人工重写要求。"""
    user_note = str(node.get('user_note') or '').strip()
    return ('撰写章节“%s”。逐项响应招标要求并标注依据;素材缺失写〔需补充〕。'
            '本章依据:%s;评分点:%s;素材槽位:%s。正文不少于 %d 个中文字符。'
            '表格必须按具体用途命名列,同一章内禁止反复使用“信息项｜内容”等泛化表头。%s' % (
                node.get('title') or '本章',
                '、'.join(str(v) for v in (node.get('basis') or [])) or '招标解析版',
                '、'.join(str(v) for v in (node.get('scoring_points') or [])) or '按响应矩阵核对',
                '、'.join(str(v) for v in (node.get('material_slots') or [])) or '无指定素材槽位',
                int(target_chars),
                ('本次为人工发起的单章重写,用户补充要求(必须落实):%s。' % user_note) if user_note else ''))


# ---------- 标准模式的模型复核:输出必须能被引擎解析,否则报告只是个文件 ----------
REVIEW_TABLE_HEADER = '| 章节 | 问题 | 级别 | 修订建议 |'


def review_task():
    return ('复核《投标文件_整册.md》对评分点、废标风险、偏离表和事实边界的覆盖情况,不改写正文。'
            '先用一段话给总体结论(可直接提交 / 补料后可提交 / 仅可作初稿);'
            '然后必须输出一张 Markdown 表,表头固定为 %s ,'
            '「章节」写章节标题原文,「级别」只能写 必办 或 建议:必办 = 不改不能投(漏答评分点、'
            '废标条款未响应、事实编造、复读或模板灌水);建议 = 改了更好。每行一个问题,'
            '「问题」写清缺什么、在哪,「修订建议」写清怎么补。没有问题时表里写一行「无」。'
            % REVIEW_TABLE_HEADER)
