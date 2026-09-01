#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模型 A/B 跑批:同一份招标文件、同一套素材,几个模型各跑一遍,把「效果好不好」变成数字。

为什么需要它:0.21.0 的一线成品里出现过「5 章节」连着复读 946 遍的整段废稿,而当时
三层门禁都说「未发现异常」。换模型这种决定不能靠「它比较新」——得有可比的数字。

用法(在装了中标狗的机器上,引擎已连好 Key):
    python3 tools/model_ab.py --tender 招标文件.docx \\
        --models deepseek-v4-flash glm-5.3-flash

说明:
- **脚本全程不碰你的 API Key**。切模型走 PUT /v1/agent,`s2_key` 留空即沿用已保存的,
  Key 既不读也不写、更不会落进结果文件。
- 引擎不允许「任务跑着的时候换模型」(config_locked_jobs),所以只能**串行**跑,
  一个模型跑完再换下一个。这也正好避免两单抢同一份素材库。
- 跑完会把引擎的模型设置**还原成开跑前的样子**(哪怕中途 Ctrl-C)。
"""
import argparse, json, os, sys, time, mimetypes, uuid
import urllib.request, urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
import doc_quality as dq                                    # noqa: E402

TERMINAL = ('completed', 'failed', 'stopped', 'needs_input')
CJK = lambda s: sum(1 for ch in s if '一' <= ch <= '鿿')
THIN_CHAPTER_CJK = 2000        # 与成品质检同一条线:低于它算「内容明显偏薄」


# ---------------------------------------------------------------- HTTP 小工具
def _req(base, path, method='GET', body=None, headers=None, timeout=120):
    url = base.rstrip('/') + path
    data, hdrs = None, dict(headers or {})
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        hdrs['Content-Type'] = 'application/json'
    r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read()
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return raw


def _get_text(base, path, timeout=120):
    r = urllib.request.Request(base.rstrip('/') + path, method='GET')
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.read().decode('utf-8', 'ignore')


def _upload_job(base, tender_path, name, timeout=300):
    """multipart 建任务并立即开跑。只用标准库,避免给客户机器加依赖。"""
    boundary = '----biddog-ab-' + uuid.uuid4().hex
    fn = os.path.basename(tender_path)
    ctype = mimetypes.guess_type(fn)[0] or 'application/octet-stream'
    parts = []
    for key, value in (('name', name), ('start', '1'), ('mock', 'auto'), ('save_to_assets', '0')):
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                      % (boundary, key, value)).encode('utf-8'))
    with open(tender_path, 'rb') as fh:
        blob = fh.read()
    parts.append(('--%s\r\nContent-Disposition: form-data; name="tender"; filename="%s"\r\n'
                  'Content-Type: %s\r\n\r\n' % (boundary, fn, ctype)).encode('utf-8'))
    parts.append(blob)
    parts.append(('\r\n--%s--\r\n' % boundary).encode('utf-8'))
    data = b''.join(parts)
    r = urllib.request.Request(base.rstrip('/') + '/v1/jobs', data=data, method='POST',
                               headers={'Content-Type': 'multipart/form-data; boundary=' + boundary,
                                        'Idempotency-Key': uuid.uuid4().hex})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


# ------------------------------------------------------------------ 指标计算
def score_run(chapters, whole, coverage, pipeline, job_row, seconds):
    """把一次跑批的原始产出压成一行可比的数字。纯函数,便于单测。

    chapters: {文件名: 正文}   whole: 整册正文(没有就空串)
    coverage: /v1/jobs/{id}/coverage 的返回   pipeline: /v1/jobs/{id}/pipeline 的返回
    job_row:  /v1/jobs 里这一单的那条   seconds: 墙钟耗时
    """
    loops, loop_detail = 0, []
    for name, text in sorted(chapters.items()):
        for line in (text or '').splitlines():
            s = line.strip()
            if not s or s.startswith('|'):
                continue
            hit = dq.degenerate_span(s)
            if hit:
                loops += 1
                loop_detail.append('%s:「%s」×%d' % (name, hit[0][:12], hit[1]))
                break                       # 一章记一次就够,不重复计数
    thin = [n for n, t in chapters.items() if CJK(t) < THIN_CHAPTER_CJK]
    nodes = (pipeline or {}).get('nodes') or []
    chapter_nodes = [n for n in nodes if str(n.get('id') or '').startswith('chapter_write:')]
    retries = sum(max(0, int(n.get('attempt') or 0) - 1) for n in chapter_nodes)
    cov = coverage or {}
    total, covered = int(cov.get('total') or 0), int(cov.get('covered') or 0)
    return {
        '出件': bool((job_row or {}).get('has_word')),
        '复读章节数': loops,
        '复读明细': loop_detail,
        '章节数': len(chapters),
        '偏薄章节数': len(thin),
        '整册汉字数': CJK(whole or ''),
        '评分点覆盖': ('%d/%d' % (covered, total)) if total else '—',
        '覆盖率': round(covered / total, 3) if total else None,
        '章节重试次数': retries,
        '耗时秒': int(seconds),
    }


def compare_table(rows):
    """把每个模型一行的结果排成 Markdown 表,按「先看能不能用,再看好不好」排列。"""
    cols = ['模型', '出件', '复读章节数', '偏薄章节数', '评分点覆盖', '章节重试次数',
            '整册汉字数', '耗时秒']
    out = ['| ' + ' | '.join(cols) + ' |', '|' + '---|' * len(cols)]
    for row in rows:
        out.append('| ' + ' | '.join([
            row['模型'], '✅' if row['出件'] else '❌', str(row['复读章节数']),
            str(row['偏薄章节数']), str(row['评分点覆盖']), str(row['章节重试次数']),
            str(row['整册汉字数']), str(row['耗时秒'])]) + ' |')
    return '\n'.join(out)


# ---------------------------------------------------------------------- 主流程
def run_one(base, model, tender, poll, budget):
    started = time.time()
    job = _upload_job(base, tender, 'AB-%s-%s' % (model, time.strftime('%H%M%S')))
    jid = job.get('job_id') or job.get('id') or ''
    if not jid:
        raise SystemExit('建任务失败:%r' % (job,))
    print('  任务 %s 已开跑,轮询中(最长 %d 分钟)…' % (jid, budget // 60), flush=True)
    row = {}
    while time.time() - started < budget:
        time.sleep(poll)
        jobs = _req(base, '/v1/jobs')
        row = next((j for j in (jobs or []) if j.get('job_id') == jid), {})
        state = str(row.get('state') or '')
        if state in TERMINAL:
            print('  终态:%s(%d 秒)' % (state, time.time() - started), flush=True)
            break
    else:
        print('  ⚠ 超时未结束,按当前状态取数', flush=True)

    arts = _req(base, '/v1/jobs/%s/artifacts' % jid) or []
    names = [a.get('name') if isinstance(a, dict) else str(a) for a in
             (arts.get('artifacts') if isinstance(arts, dict) else arts)]
    chapters, whole = {}, ''
    for name in [n for n in names if n and n.endswith('.md')]:
        try:
            text = _get_text(base, '/v1/jobs/%s/artifacts/%s' % (jid, urllib.parse.quote(name)))
        except Exception:
            continue
        if name.startswith(('章节', '第')):
            chapters[name] = text
        elif '整册' in name:
            whole = text
    try:
        coverage = _req(base, '/v1/jobs/%s/coverage' % jid)
    except Exception:
        coverage = {}
    try:
        pipeline = _req(base, '/v1/jobs/%s/pipeline' % jid)
    except Exception:
        pipeline = {}
    result = score_run(chapters, whole, coverage, pipeline, row, time.time() - started)
    result.update({'模型': model, 'job_id': jid, '终态': str(row.get('state') or '')})
    return result


def main():
    ap = argparse.ArgumentParser(description='中标狗模型 A/B 跑批')
    ap.add_argument('--base', default='http://127.0.0.1:18901', help='引擎地址')
    ap.add_argument('--tender', required=True, help='招标文件(所有模型用同一份)')
    ap.add_argument('--models', nargs='+', required=True, help='要对比的模型 id')
    ap.add_argument('--poll', type=int, default=20, help='轮询间隔秒')
    ap.add_argument('--budget', type=int, default=3600, help='每个模型最长等待秒')
    ap.add_argument('--out', default='model_ab_result.json')
    args = ap.parse_args()

    if not os.path.isfile(args.tender):
        raise SystemExit('招标文件不存在:%s' % args.tender)
    original = _req(args.base, '/v1/agent')
    print('开跑前的模型:%s' % (original.get('s2_model_effective') or original.get('s2_model') or '(默认)'))

    rows = []
    try:
        for model in args.models:
            print('\n=== %s ===' % model, flush=True)
            # s2_key 不传 = 沿用已保存的:脚本不读也不写你的 Key
            body = dict(original)
            body.pop('s2_model_effective', None)
            body['s2_model'] = model
            r = _req(args.base, '/v1/agent', 'PUT', body)
            if not r.get('ok'):
                print('  ✗ 切模型失败:%r(跳过)' % (r,), flush=True)
                continue
            print('  已切到 %s' % (r.get('s2_model_effective') or model), flush=True)
            rows.append(run_one(args.base, model, args.tender, args.poll, args.budget))
    finally:
        restore = dict(original); restore.pop('s2_model_effective', None)
        try:
            _req(args.base, '/v1/agent', 'PUT', restore)
            print('\n已还原开跑前的模型设置。')
        except Exception as exc:
            print('\n⚠ 还原模型设置失败,请到「设置 · 模型接入」手动确认:%s' % exc)

    if rows:
        print('\n' + compare_table(rows))
        for row in rows:
            if row['复读明细']:
                print('\n%s 的复读:%s' % (row['模型'], '; '.join(row['复读明细'][:5])))
        with open(args.out, 'w', encoding='utf-8') as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)
        print('\n原始数据:%s' % args.out)


if __name__ == '__main__':
    main()
