# -*- coding: utf-8 -*-
"""模型复读循环:从「悄悄进 Word」变成「当场拦住」。

一线实测的一份 v0.21.0 成品(深圳某市政项目,10 万字):第五章开头整段是
    「第五章 资源配置与项目管理机构管理。招标文件第 5 机构。 项目管理机构。
      5 章节。 5 章节。 5 章节。……」
「5 章节」连着重复 946 遍、整段 5781 字,而且这一整段挂在**章标题**的样式上。

三层门禁全都没拦住,原因各不相同,这里逐条钉住:
1. doc_quality.detect 的重复检测用 Counter 数「段与段之间」的重复,整个循环落在
   同一段里 → max_repeat=1,报「✅ 未发现异常」;
2. 就算数对了,read_any 会给标题行加 '#',而 detect 的 body 把 '#' 开头的行过滤掉,
   复读挂在标题上正好躲过扫描;
3. generation_pipeline 这层只有 min_chars 长度门槛——卡进循环的模型字数从来不缺,
   长度门槛反而在奖励复读。
"""
import json

import pytest

import doc_quality as dq
import generation_pipeline


# 真实成品里那一段的形状:一点正常开头 + 迅速塌缩成复读
DEGENERATE = ("第五章 资源配置与项目管理机构管理。招标文件第 5 机构。 项目管理机构。"
              + "5 章节。 " * 946)


def test_the_real_world_loop_is_detected():
    hit = dq.degenerate_span(DEGENERATE)
    assert hit is not None
    unit, times, share = hit
    assert unit == "5 章节"
    assert times >= 900
    assert share > 0.9


def test_the_loop_is_still_caught_when_it_rides_on_a_heading():
    """现场那一段是挂在章标题上的。按 body 过滤(跳过 '#' 开头)会正好把它藏起来。"""
    report = dq.detect("# " + DEGENERATE + "\n\n正常的一段正文，用来凑出可比的段落数。\n")
    assert not report["ok"]
    codes = [i["code"] for i in report["issues"]]
    assert "loop" in codes
    assert report["stats"]["loops"] == 1


def test_repair_collapses_the_loop_to_a_single_pass():
    fixed = dq.repair("# " + DEGENERATE + "\n")
    assert fixed.count("5 章节") == 1
    assert len(fixed) < 300                      # 5781 字的复读折成一句
    assert fixed.lstrip().startswith("#")        # 标题还是标题，不能折没了
    assert dq.detect(fixed)["ok"]


def test_a_short_loop_is_left_to_the_length_gates():
    """门槛定在 1200 字是有理由的:短复读本来就会被 min_chars 这类长度门槛拦下,
    复读门禁存在的理由恰恰是「长度门槛反过来奖励长复读」——卡住的模型字数从来不缺。
    一线实测那段是 5781 字,离这条线很远。"""
    assert dq.degenerate_span("补充说明。" * 60) is None       # ~300 字,长度门槛会拦
    assert dq.degenerate_span("补充说明。" * 400) is not None   # ~2000 字,长度门槛拦不住


@pytest.mark.parametrize("text", [
    # 投标文件里正常的排比与重复措辞，一条都不许误报
    "我方承诺严格执行国家、广东省及深圳市现行有效标准；当标准不一致时执行较严格者；"
    "当标准修订时执行修订后版本；当招标文件另有约定时执行招标文件约定。",
    "项目部设项目经理 1 名、技术负责人 1 名、施工员 2 名、质量员 2 名、安全员 2 名、"
    "材料员 1 名、资料员 1 名、试验员 1 名，均专职到岗，不得兼任其他在建项目同类岗位。",
    "| 序号 | 招标条款 | 投标响应 | 偏离情况 |\n| 1 | 工期 | 已响应 | 无偏离 |",
    "无偏离。无偏离。无偏离。",                    # 短句重复：正常表述，长度不到门槛
])
def test_normal_bid_prose_is_not_flagged(text):
    assert dq.degenerate_span(text) is None


def test_a_loop_without_punctuation_is_caught_too():
    """没有句读的复读(「安全安全安全…」)走 n-gram 多样性兜底。"""
    hit = dq.degenerate_span("安全文明施工" * 300)
    assert hit is not None


def test_chapter_output_that_loops_is_rejected_even_though_it_is_long_enough(tmp_path):
    """核心回归:长度门槛拦不住复读——它字数从来不缺。

    validate_outputs 抛 OutputValidationError,引擎侧会归成 node_output_invalid
    (retryable=True),本章按既有重试预算自动重跑,不会带着废稿往下走。"""
    chapter = tmp_path / "章节_05_资源配置与项目管理机构.md"
    chapter.write_text(DEGENERATE, encoding="utf-8")
    node = {"id": "chapter_write:c5", "outputs": [chapter.name], "min_chars": 2500}

    assert len(DEGENERATE) > node["min_chars"]          # 长度门槛这一关它是过得去的
    with pytest.raises(generation_pipeline.OutputValidationError) as excinfo:
        generation_pipeline.validate_outputs(tmp_path, node)
    assert "复读" in str(excinfo.value)


def test_a_real_chapter_still_passes_validation(tmp_path):
    chapter = tmp_path / "章节_05_资源配置与项目管理机构.md"
    chapter.write_text(
        "# 第五章 资源配置与项目管理机构\n\n"
        + "本章说明项目管理机构设置、岗位职责与资源投入计划。\n" * 60,
        encoding="utf-8")
    node = {"id": "chapter_write:c5", "outputs": [chapter.name], "min_chars": 500}
    generation_pipeline.validate_outputs(tmp_path, node)      # 不抛就是通过


def test_content_gate_asks_for_a_rewrite_not_just_a_cleanup(engine, job):
    """折叠只能把几百遍变成一遍,折完这一章仍旧没有内容。
    首选动作必须是「重做这一章」,否则修完看着干净、交出去还是废稿。"""
    (job / "章节_05_资源配置与项目管理机构.md").write_text(DEGENERATE, encoding="utf-8")
    (job / "投标文件_整册.docx").write_bytes(b"")             # 只为让门禁走内容分支
    result = engine.content_gate(str(job), ["章节_05_资源配置与项目管理机构.md"])
    assert result["status"] == "fail" and result["level"] == "red"

    # 门禁把 gap 发在 health 事件里,顺着事件流核对首选动作
    events = [json.loads(l) for l in
              (job / "events.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    gaps = [g for e in events if e.get("type") == "health" for g in (e.get("gaps") or [])]
    loop_gap = next(g for g in gaps if "复读" in g["title"])
    acts = loop_gap["actions"]
    assert acts[0]["act"] == "redo"                       # 首选是重做,不是清洗
    assert "章节_05_资源配置与项目管理机构" in acts[0]["param"]
    assert [a["act"] for a in acts[1:]] == ["repair"]     # 清洗降为次选,仍然留着
