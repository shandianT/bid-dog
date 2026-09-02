# -*- coding: utf-8 -*-
"""模型 A/B 跑批的取数口径。

换模型这种决定不能靠「它比较新」——0.21.0 那份复读 946 遍的成品就是教训:
当时三层门禁都说「未发现异常」。这里钉住的是「怎么把效果变成可比的数字」,
特别是复读率——它现在是能数出来的,而且正是模型之间差别最大的地方之一。
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
_spec = importlib.util.spec_from_file_location("model_ab", ROOT / "tools" / "model_ab.py")
model_ab = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(model_ab)


GOOD_CHAPTER = "".join(
    "第%d条：针对本项目的实施安排，明确责任岗位、完成时限与验收口径，并留存过程记录。" % i
    for i in range(1, 90))
LOOPED_CHAPTER = "第五章 资源配置。招标文件第 5 机构。" + "5 章节。 " * 946


def _pipeline(attempts):
    return {"nodes": [{"id": "chapter_write:c%d" % i, "attempt": a}
                      for i, a in enumerate(attempts, 1)]}


def test_a_looped_chapter_is_counted_and_named():
    row = model_ab.score_run(
        {"章节_05_资源配置.md": LOOPED_CHAPTER, "章节_01_项目理解.md": GOOD_CHAPTER},
        whole=GOOD_CHAPTER, coverage={"total": 19, "covered": 12},
        pipeline=_pipeline([1, 3]), job_row={"has_word": True}, seconds=930)
    assert row["复读章节数"] == 1
    assert any("章节_05_资源配置.md" in d and "5 章节" in d for d in row["复读明细"])
    assert row["评分点覆盖"] == "12/19" and row["覆盖率"] == 0.632
    assert row["章节重试次数"] == 2          # attempt 1 与 3 → 0 + 2 次重试
    assert row["出件"] is True and row["耗时秒"] == 930


def test_a_clean_run_scores_zero_loops():
    row = model_ab.score_run(
        {"章节_01_项目理解.md": GOOD_CHAPTER}, whole=GOOD_CHAPTER,
        coverage={"total": 19, "covered": 19}, pipeline=_pipeline([1]),
        job_row={"has_word": True}, seconds=600)
    assert row["复读章节数"] == 0 and row["复读明细"] == []
    assert row["偏薄章节数"] == 0            # GOOD_CHAPTER 超过 2000 汉字
    assert row["覆盖率"] == 1.0


def test_one_chapter_is_counted_once_however_many_lines_loop():
    """一章里多段复读只记一次:要的是「几章坏了」,不是「坏了几行」。"""
    row = model_ab.score_run(
        {"章节_05.md": LOOPED_CHAPTER + "\n" + LOOPED_CHAPTER}, whole="",
        coverage={}, pipeline={}, job_row={}, seconds=10)
    assert row["复读章节数"] == 1


def test_thin_chapters_are_flagged_against_the_same_line_as_the_audit():
    row = model_ab.score_run(
        {"章节_01.md": "太短了。" * 10, "章节_02.md": GOOD_CHAPTER}, whole="",
        coverage={}, pipeline={}, job_row={}, seconds=10)
    assert row["偏薄章节数"] == 1
    assert model_ab.THIN_CHAPTER_CJK == 2000     # 与成品质检同一条线,别各说各话


def test_missing_coverage_reads_as_dash_not_zero():
    """拿不到覆盖度就如实写「—」,不能编成 0/0 让人以为跑出了 0 分。"""
    row = model_ab.score_run({}, "", coverage={}, pipeline={}, job_row={}, seconds=1)
    assert row["评分点覆盖"] == "—" and row["覆盖率"] is None


def test_table_puts_usability_before_polish():
    rows = [
        {"模型": "a", "出件": True, "复读章节数": 0, "偏薄章节数": 1,
         "评分点覆盖": "18/19", "章节重试次数": 0, "整册汉字数": 90000, "耗时秒": 700},
        {"模型": "b", "出件": False, "复读章节数": 3, "偏薄章节数": 4,
         "评分点覆盖": "9/19", "章节重试次数": 6, "整册汉字数": 40000, "耗时秒": 1500},
    ]
    table = model_ab.compare_table(rows)
    header = table.splitlines()[0]
    assert header.index("出件") < header.index("复读章节数") < header.index("整册汉字数")
    assert "✅" in table and "❌" in table


def test_variant_spec_carries_generation_params_and_keeps_the_label():
    """同一模型两组参数在结果表里必须分得开:标签原样,参数只认三个键,非数字忽略。"""
    model, params, label = model_ab.parse_variant(
        "deepseek-v4-flash?temperature=0.5&frequency_penalty=0.4&bogus=1&presence_penalty=x")
    assert model == "deepseek-v4-flash"
    assert params == {"temperature": 0.5, "frequency_penalty": 0.4}
    assert label == "deepseek-v4-flash?temperature=0.5&frequency_penalty=0.4&bogus=1&presence_penalty=x"

    model, params, label = model_ab.parse_variant("glm-5.3-flash")
    assert (model, params, label) == ("glm-5.3-flash", {}, "glm-5.3-flash")

    # 全局参数只给没单独写的键兜底
    _m, params, _l = model_ab.parse_variant("m?temperature=0.2", {"temperature": 0.9, "frequency_penalty": 0.3})
    assert params == {"temperature": 0.2, "frequency_penalty": 0.3}
