"""v0.20.4 素材入库格式扩展与打标容错的回归测试。

覆盖真机反馈:合同截图打标 JSON 截断(反馈 4)、PDF/doc/图片入库(反馈 1/2/3)、
参考资料不再泄漏进全局素材库(潜在串档)。
"""
import json
import os
from pathlib import Path

import pytest


def test_lenient_json_load_accepts_strict_json(engine):
    assert engine._lenient_json_load('{"a": "b"}') == {"a": "b"}


def test_lenient_json_load_repairs_truncated_string(engine):
    # max_tokens 截断:字符串停在半截(真机报错 Unterminated string 的形态)
    broken = '{"category":"资质证书","caption":"ISO9001 质量管理'
    fixed = engine._lenient_json_load(broken)
    assert fixed["category"] == "资质证书"


def test_lenient_json_load_repairs_missing_delimiter_tail(engine):
    # 尾部残缺键值对(真机报错 Expecting ',' delimiter 的形态)
    broken = '{"category":"案例证明","caption":"合同截图","ocr":"金额:壹佰万元","keywords"'
    fixed = engine._lenient_json_load(broken)
    assert fixed["category"] == "案例证明"
    assert fixed["ocr"].startswith("金额")


def test_lenient_json_load_escapes_raw_newlines_inside_strings(engine):
    broken = '{"caption":"第一行\n第二行","category":"其他"}'
    fixed = engine._lenient_json_load(broken)
    assert "第二行" in fixed["caption"]


def test_promote_headings_promotes_numbered_lines(engine):
    text = "第一章 总体要求\n正文内容第一段。\n一、资格条件\n1.1 营业执照\n这句是超过四十个字的正文,绝对不能被误提升成标题," \
           "否则整章结构就乱了,这里补足长度确保超过阈值。"
    out = engine.promote_headings(text)
    assert "# 第一章 总体要求" in out
    assert "## 一、资格条件" in out
    assert "### 1.1 营业执照" in out
    assert "# 这句" not in out


def test_promote_headings_keeps_existing_markdown(engine):
    text = "# 已有标题\n第一章 这行不该再被动"
    assert engine.promote_headings(text) == text


def test_rtf_to_text_decodes_gbk_escapes(engine):
    blob = ("{\\rtf1\\ansi\\ansicpg936 {\\fonttbl}"
            "\\par " + "\\'d6\\'d0\\'b1\\'ea" + " bid\\par }").encode("latin-1")
    text = engine.rtf_to_text(blob)
    assert "中标" in text
    assert "bid" in text


def test_html_to_text_strips_tags_and_scripts(engine):
    blob = "<html><head><script>var x=1;</script></head><body><h1>资质证书</h1><p>建筑业企业</p></body></html>".encode("utf-8")
    text = engine.html_to_text(blob)
    assert "资质证书" in text and "建筑业企业" in text
    assert "var x" not in text


def test_ingest_rejects_unknown_extension_with_actionable_message(engine, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(engine, "MULTIUSER", False, raising=False)
    client = TestClient(engine.app)
    resp = client.post("/v1/assets/ingest", files={"file": ("素材.xyz", b"data", "application/octet-stream")})
    assert resp.status_code == 400
    assert "docx" in resp.json()["error"]


def test_ingest_accepts_single_image_into_library(engine, tmp_path):
    from fastapi.testclient import TestClient
    client = TestClient(engine.app)
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    resp = client.post("/v1/assets/ingest", files={"file": ("资质图.png", png, "image/png")})
    body = resp.json()
    assert resp.status_code == 200 and body["ok"] is True
    assert body["images"] == 1
    lib = Path(engine.assets_dir())
    assert (lib / "图片" / "资质图.png").is_file()
    entries = json.loads((lib / "图片索引.json").read_text(encoding="utf-8"))
    assert any(e["file"] == "资质图.png" for e in entries)


def test_ingest_html_splits_sections(engine):
    from fastapi.testclient import TestClient
    client = TestClient(engine.app)
    html = ("<html><body><h1>公司介绍</h1><p>" + "我们是一家专业公司。" * 10 +
            "</p></body></html>").encode("utf-8")
    resp = client.post("/v1/assets/ingest", files={"file": ("公司介绍.html", html, "text/html")})
    body = resp.json()
    assert resp.status_code == 200 and body["ok"] is True
    assert body["sections"] >= 1


def test_attachment_never_leaks_into_global_assets(engine, tmp_path):
    """无 素材/ 目录的任务上传参考资料,绝不能写进全局素材库(跨项目串档)。"""
    from fastapi.testclient import TestClient
    client = TestClient(engine.app)
    job = tmp_path / "jobs" / "job-att"
    job.mkdir(parents=True)
    engine.write_json(str(job / "任务.json"), {"name": "串档测试", "tender": "t.docx"})
    resp = client.post("/v1/jobs/job-att/attachments",
                       files={"file": ("去年中标标书.docx", b"PK\x03\x04fake", "application/octet-stream")})
    assert resp.status_code == 200
    assert (job / "素材" / "参考资料" / "去年中标标书.docx").is_file()
    lib = Path(engine.assets_dir())
    assert not (lib / "参考资料" / "去年中标标书.docx").exists()


def test_attachments_listing_returns_uploaded_materials(engine, tmp_path):
    """反馈 7:创建任务导入的素材必须能在任务详情列出来。"""
    job = tmp_path / "jobs" / "job-mats"
    (job / "素材").mkdir(parents=True)
    (job / "素材" / "历史投标文件.docx").write_bytes(b"x" * 2048)
    engine.write_json(str(job / "任务.json"), {
        "name": "素材展示", "tender": "t.docx",
        "uploaded_materials": ["历史投标文件.docx", "不存在的.docx"],
    })
    rows = engine.list_attachments("job-mats")
    kinds = {(r["name"], r["kind"]) for r in rows}
    assert ("历史投标文件.docx", "material") in kinds
    assert all(r["name"] != "不存在的.docx" for r in rows)


def test_vision_worker_degrades_failed_images_instead_of_dropping(engine, tmp_path, monkeypatch):
    """反馈 4:识别失败的图不再掉出索引,降级登记后可重试。"""
    lib = Path(engine.assets_dir())
    img_dir = lib / "图片"
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "标书图_deadbeef00.jpeg").write_bytes(b"\xff\xd8\xff" + b"0" * 32)
    monkeypatch.setattr(engine, "_vision_provider",
                        lambda: ({"vision_model": "test-vl", "base_url": "http://x", "api_key": "k"}, ""))
    monkeypatch.setattr(engine, "tag_one_image",
                        lambda *_a, **_k: (_ for _ in ()).throw(ValueError("模型返回的打标结果不是有效 JSON")))
    engine.VISION.update(running=True, done=0, total=0, updated=0, degraded=0, errors=[])
    engine.vision_worker(False)
    assert engine.VISION["degraded"] == 1
    entries = json.loads((lib / "图片索引.json").read_text(encoding="utf-8"))
    row = next(e for e in entries if e["file"] == "标书图_deadbeef00.jpeg")
    assert row["id"].startswith("待整理-")
    # 降级行必须仍算「未完成」,下一轮非 force 打标会重试
    done = {e.get("file") for e in entries
            if e.get("id") and not str(e.get("id")).startswith(("标书图", "待整理"))}
    assert "标书图_deadbeef00.jpeg" not in done
