#!/usr/bin/env python3
"""Manual, real-upstream release acceptance.

This is intentionally not a pytest file and is never called by run_all.sh.
It replaces the missing ab_run.py/score3.py only at the observable-contract
level; it does not claim to reproduce their lost scoring implementation.
"""

import argparse
import getpass
import hashlib
import io
import json
import os
import re
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

import httpx


MODELS = {"standard": "senseaudio-s2", "fast": "deepseek-v4-flash"}
TERMINAL = {"done", "stopped", "unknown"}
NOT_BODY = (
    "自检", "清洗", "报告", "质检", "门禁", "矩阵", "偏离表", "解析版",
    "配图清单", "补料", "废标", "组成", "索引", "格式要求", "大纲", ".bak",
)
BODY_WORD_MARKS = ("投标", "技术标", "商务标", "标书", "方案", "响应文件")


def docx_text(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    tag = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
    return "".join(node.text or "" for node in root.iter(tag))


def text_shingles(text, width=20):
    compact = re.sub(r"\s+", "", text)
    return {compact[i : i + width] for i in range(max(0, len(compact) - width + 1))}


def load_samples(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    samples = payload.get("samples") if isinstance(payload, dict) else None
    if not isinstance(samples, list) or len(samples) != 3:
        raise ValueError("sample manifest must contain exactly three samples")
    out = []
    hashes = set()
    shingle_sets = []
    for index, item in enumerate(samples, 1):
        name = str((item or {}).get("name") or "sample-%d" % index).strip()
        source = Path(str((item or {}).get("path") or "")).expanduser()
        if not source.is_file():
            raise FileNotFoundError("sample %s does not exist" % name)
        if "虚拟" in name or "虚拟" in source.name:
            raise ValueError("sample %s is marked as virtual, not real acceptance data" % name)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest in hashes:
            raise ValueError("sample %s duplicates another file byte-for-byte" % name)
        hashes.add(digest)
        shingles = text_shingles(docx_text(source))
        for previous in shingle_sets:
            union = shingles | previous
            similarity = len(shingles & previous) / len(union) if union else 1.0
            if similarity >= 0.70:
                raise ValueError("sample %s substantially duplicates another document" % name)
        shingle_sets.append(shingles)
        out.append({"name": name, "path": source})
    return out


def assert_loopback(url):
    host = (urlparse(url).hostname or "").lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("engine URL must be loopback; refusing to send credentials to %s" % host)


def configure(client, upstream, key, model, verify_ssl):
    response = client.put(
        "/v1/agent",
        json={
            "kind": "s2",
            "mode": "agents",
            "s2_base_url": upstream,
            "s2_model": model,
            "s2_key": key,
            "s2_wire": "auto",
            "s2_verify_ssl": verify_ssl,
        },
    )
    response.raise_for_status()
    if not response.json().get("ok"):
        raise RuntimeError("local engine rejected the acceptance configuration")


def clear_key(client):
    try:
        client.put(
            "/v1/agent",
            json={"kind": "s2", "s2_key_clear": True, "s2_key": ""},
        )
    except Exception:
        pass


def probe_agent(client):
    response = client.post("/v1/agent/test")
    response.raise_for_status()
    payload = response.json()
    if not payload.get("ok"):
        raise RuntimeError("configured execution shell failed its real connectivity probe")


def create_job(client, sample):
    with sample["path"].open("rb") as source:
        response = client.post(
            "/v1/jobs",
            files={
                "tender": (
                    sample["path"].name,
                    source,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
            data={
                "name": "发版验收 · " + sample["name"],
                "prompt": "按技能包完整生成并执行全部出件门禁；这是发版验收，不得跳步。",
                "mock": "0",
                "start": "1",
            },
        )
    response.raise_for_status()
    job_id = response.json().get("job_id")
    if not job_id:
        raise RuntimeError("local engine did not return a job id")
    return job_id


def wait_job(client, job_id, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        jobs = client.get("/v1/jobs").json()
        current = next((job for job in jobs if job.get("job_id") == job_id), None)
        if current and current.get("state") in TERMINAL:
            return current
        time.sleep(5)
    raise TimeoutError("acceptance job exceeded %.0f minutes" % (timeout / 60))


def artifact_bytes(client, artifact):
    response = client.get(artifact["url"])
    response.raise_for_status()
    return response.content


def artifact_text(client, artifact):
    return artifact_bytes(client, artifact).decode("utf-8", "ignore")


def is_body_word(name):
    value = str(name or "")
    return (
        value.lower().endswith(".docx")
        and not any(mark in value for mark in NOT_BODY)
        and any(mark in value for mark in BODY_WORD_MARKS)
    )


def tabular_rows(content, name):
    if str(name).lower().endswith(".xlsx"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as workbook:
                total = 0
                for item in workbook.namelist():
                    if item.startswith("xl/worksheets/sheet") and item.endswith(".xml"):
                        root = ET.fromstring(workbook.read(item))
                        total = max(total, sum(1 for node in root.iter() if node.tag.endswith("}row")))
                return total
        except (zipfile.BadZipFile, KeyError, ET.ParseError):
            return 0
    return len(content.decode("utf-8", "ignore").splitlines())


def assess(client, job_id, state):
    artifacts = client.get("/v1/jobs/%s/artifacts" % job_id).json()
    names = [str(item.get("name") or "") for item in artifacts]
    word = any(is_body_word(name) for name in names)
    index_ok = any("评标索引" in name for name in names)

    deviation_rows = 0
    for item in artifacts:
        if "偏离表" in str(item.get("name") or ""):
            content = artifact_bytes(client, item)
            deviation_rows = max(deviation_rows, tabular_rows(content, item.get("name")))

    report = next((item for item in artifacts if "成品质检报告" in str(item.get("name") or "")), None)
    report_text = artifact_text(client, report) if report else ""
    quality_ok = bool(report_text) and "🔴" not in report_text
    template_match = re.search(r"模板化(?:命中)?[^0-9]{0,16}(\d+)", report_text)
    template_hits = int(template_match.group(1)) if template_match else None
    template_ok = template_hits == 0

    return {
        "word": word,
        "index": index_ok,
        "deviation_rows": deviation_rows,
        "quality": quality_ok,
        "template_hits": template_hits,
        "passed": state == "done" and word and index_ok and deviation_rows >= 50 and quality_ok and template_ok,
    }


def write_report(path, mode, model, rows):
    lines = [
        "# v0.20.0 人工出件验收",
        "",
        "- 模式：%s" % mode,
        "- 模型：%s" % model,
        "- 时间：%s" % time.strftime("%Y-%m-%d %H:%M:%S"),
        "- 说明：报告不含 Key、原始文件内容或本机绝对路径。",
        "",
        "| 样本 | 终态 | 用时(分) | Word | 评标索引 | 偏离表行数 | 质检非红 | 模板化命中 | 结论 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in rows:
        score = row["score"]
        lines.append(
            "| %s | %s | %.1f | %s | %s | %d | %s | %s | %s |"
            % (
                row["name"].replace("|", "／"),
                row["state"],
                row.get("elapsed_minutes", 0),
                "✅" if score["word"] else "❌",
                "✅" if score["index"] else "❌",
                score["deviation_rows"],
                "✅" if score["quality"] else "❌",
                "未知" if score["template_hits"] is None else score["template_hits"],
                "通过" if score["passed"] else "不通过",
            )
        )
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run three real tender acceptance jobs against a local engine")
    parser.add_argument("--samples", required=True, help="local sample manifest; never commit it")
    parser.add_argument("--engine-url", default="http://127.0.0.1:8080")
    parser.add_argument("--upstream", default=os.environ.get("BIDDOG_ACCEPTANCE_BASE_URL", ""))
    parser.add_argument("--mode", choices=sorted(MODELS), default="standard")
    parser.add_argument("--timeout-minutes", type=float, default=240)
    parser.add_argument("--output", default="tests/acceptance-results-%s.md" % time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--insecure", action="store_true", help="allow only when the configured upstream is trusted")
    parser.add_argument("--prompt-key", action="store_true", help="read the Key without echoing or placing it in shell history")
    args = parser.parse_args(argv)

    if os.environ.get("BIDDOG_RUN_ACCEPTANCE") != "1":
        parser.error("set BIDDOG_RUN_ACCEPTANCE=1 to acknowledge real usage/cost")
    key = os.environ.get("BIDDOG_ACCEPTANCE_KEY", "").strip()
    if not key and args.prompt_key:
        key = getpass.getpass("验收 Key（不会回显）: ").strip()
    if not key:
        parser.error("BIDDOG_ACCEPTANCE_KEY is required")
    if not args.upstream:
        parser.error("--upstream or BIDDOG_ACCEPTANCE_BASE_URL is required")
    assert_loopback(args.engine_url)
    samples = load_samples(args.samples)
    model = MODELS[args.mode]
    rows = []

    # 回环引擎绝不能继承公司代理；否则 127.0.0.1 会被代理成 502，且有误送凭据的风险。
    with httpx.Client(base_url=args.engine_url, timeout=60, trust_env=False) as client:
        health = client.get("/v1/health")
        health.raise_for_status()
        version = str(health.json().get("version") or "")
        if version != "0.20.0":
            raise RuntimeError("acceptance requires engine v0.20.0, got %s" % (version or "unknown"))
        configure(client, args.upstream, key, model, not args.insecure)
        try:
            probe_agent(client)
            for sample in samples:
                started = time.monotonic()
                try:
                    job_id = create_job(client, sample)
                    terminal = wait_job(client, job_id, args.timeout_minutes * 60)
                    state = terminal.get("state") or "unknown"
                    score = assess(client, job_id, state)
                except Exception as exc:
                    state = "error:%s" % type(exc).__name__
                    score = {"word": False, "index": False, "deviation_rows": 0,
                             "quality": False, "template_hits": None, "passed": False}
                rows.append(
                    {
                        "name": sample["name"],
                        "state": state,
                        "elapsed_minutes": round((time.monotonic() - started) / 60, 1),
                        "score": score,
                    }
                )
                write_report(args.output, args.mode, model, rows)
        finally:
            clear_key(client)

    write_report(args.output, args.mode, model, rows)
    key = ""
    print("acceptance report written:", args.output)
    return 0 if all(row["score"]["passed"] for row in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
