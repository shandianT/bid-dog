"""P4a:模型调用记账与用量看板、任务包导入、分册输出、整册优先。"""
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# ------------------------------------------------------------------ 用量记账
def test_model_usage_prefers_gateway_numbers_and_falls_back_to_estimates(engine, job):
    payload = {'messages': [{'role': 'system', 'content': '甲' * 150}, {'role': 'user', 'content': '乙' * 150}]}
    engine._record_model_usage(str(job), 'm-fast', payload, {'choices': [{'message': {'content': '丙' * 300}}]})
    first = engine.read_json(str(job / 'usage.json'), {})
    assert first['calls'] == 1 and first['estimated'] is True
    assert first['input_tokens'] == 200 and first['output_tokens'] == 200          # 300 字 / 1.5
    engine._record_model_usage(str(job), 'm-quality', payload, {
        'choices': [{'message': {'content': 'x'}}], 'usage': {'prompt_tokens': 1000, 'completion_tokens': 50}})
    second = engine.read_json(str(job / 'usage.json'), {})
    assert second['calls'] == 2 and second['input_tokens'] == 1200 and second['output_tokens'] == 250
    assert second['estimated_calls'] == 1 and second['estimated'] is True and second['model'] == 'm-quality'
    assert set(second['by_model']) == {'m-fast', 'm-quality'} and second['by_model']['m-quality']['calls'] == 1
    view = engine._job_usage(str(job))
    assert view['total_tokens'] == 1450 and view['estimated'] is True


def test_stream_reader_keeps_usage_when_the_gateway_sends_it(engine, monkeypatch):
    chunks = [line.encode('utf-8') for line in (
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
        'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n',
        'data: [DONE]\n')]

    class _Resp:
        def __iter__(self): return iter(chunks)
        def __enter__(self): return self
        def __exit__(self, *_a): return False
        def close(self): pass

    monkeypatch.setattr(engine.urllib.request, 'urlopen', lambda *_a, **_k: _Resp())
    out = engine._openai_stream_req('https://gw.example', 'k', {'model': 'm', 'messages': []})
    assert out['choices'][0]['message']['content'] == '你好世界'
    assert out['usage'] == {'prompt_tokens': 12, 'completion_tokens': 4}


def _mk_job(engine, tmp_path, name, created, usage=None, diagnostics=(), chapters=0):
    job = Path(engine.jpath(name)); job.mkdir(parents=True)
    engine.write_json(str(job / '任务.json'), {'name': name, 'tender': '', 'created_at': created})
    if usage is not None: engine.write_json(str(job / 'usage.json'), usage)
    if diagnostics:
        (job / 'diagnostics.jsonl').write_text('\n'.join(json.dumps(d, ensure_ascii=False) for d in diagnostics) + '\n', encoding='utf-8')
    if chapters:
        engine.generation_pipeline.initialize(job, run_id='r-' + name, mode='fast',
            model_routes={'fast': 'm', 'quality': 'm'},
            chapters=[{'id': '%02d' % i, 'title': '章 %d' % i, 'output': '章节_%02d.md' % i} for i in range(1, chapters + 1)])
    return job


def test_usage_dashboard_aggregates_by_job_model_and_day(engine, tmp_path):
    _mk_job(engine, tmp_path, 'u-old', '2020-01-01 10:00:00', {'calls': 9, 'input_tokens': 9, 'output_tokens': 9, 'total_tokens': 18, 'model': 'old'})
    _mk_job(engine, tmp_path, 'u-a', engine.now(), {'calls': 3, 'input_tokens': 300, 'output_tokens': 100, 'total_tokens': 400,
                                                    'model': 'm-fast', 'estimated': True,
                                                    'by_model': {'m-fast': {'calls': 3, 'input_tokens': 300, 'output_tokens': 100}}},
            diagnostics=[{'code': 'chapter_gate', 'detail': '输出卡进复读循环:章节_01 里「5 章节」连着重复 900 遍'}], chapters=4)
    _mk_job(engine, tmp_path, 'u-b', engine.now(), {'calls': 2, 'input_tokens': 50, 'output_tokens': 20, 'total_tokens': 70,
                                                    'model': 'm-fast', 'estimated_cost': 0.12, 'currency': 'USD'})
    with TestClient(engine.app) as client:
        body = client.get('/v1/usage?days=30').json()
    assert body['ok'] is True and body['totals']['jobs'] == 2            # 2020 年那单不在近 30 天
    assert body['totals']['calls'] == 5 and body['totals']['total_tokens'] == 470
    assert body['totals']['estimated_cost'] == 0.12 and body['totals']['currency'] == 'USD'
    assert body['totals']['repeat_hits'] == 1 and body['totals']['chapters'] == 4
    model = next(m for m in body['by_model'] if m['model'] == 'm-fast')
    assert model['jobs'] == 2 and model['calls'] == 5 and model['repeat_rate'] == 25.0
    rows = {r['job_id']: r for r in body['jobs']}
    assert rows['u-a']['estimated'] is True and rows['u-a']['repeat_hits'] == 1 and rows['u-a']['chapters'] == 4
    assert rows['u-b']['estimated'] is False and rows['u-b']['estimated_cost'] == 0.12
    assert body['by_day'] and body['by_day'][-1]['jobs'] == 2
    with TestClient(engine.app) as client:
        assert client.get('/v1/usage?days=99999').json()['totals']['jobs'] == 3     # 上限 3650 天,老单也进来


# ------------------------------------------------------------------ 任务包导入
def _zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, data in entries: z.writestr(name, data)
    return buf.getvalue()


def test_import_job_zip_creates_a_job_from_exported_deliverables(engine):
    blob = _zip([('0901-1200-ab12/投标文件_整册.md', '# 投标文件\n\n正文。\n'),
                 ('0901-1200-ab12/成品质检报告.md', '# 质检\n'),
                 ('0901-1200-ab12/任务.json', json.dumps({'name': '清湖片区', 'prompt': '要求'})),
                 ('0901-1200-ab12/../逃逸.md', '坏'), ('0901-1200-ab12/.hidden.md', '坏'),
                 ('0901-1200-ab12/engine.log', '日志不进'), ('other-job/投标文件.md', '第二个任务不进')])
    with TestClient(engine.app) as client:
        r = client.post('/v1/jobs/import', files={'file': ('中标狗_任务导出.zip', blob, 'application/zip')})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['ok'] is True and body['files'] == 2 and body['skipped'] == 4 and body['name'] == '清湖片区 · 导入'
        job = Path(engine.jpath(body['job_id']))
        assert (job / '投标文件_整册.md').is_file() and (job / '成品质检报告.md').is_file()
        assert not (job / '逃逸.md').exists() and not (job / 'engine.log').exists() and not (job / '投标文件.md').exists()
        meta = engine.read_json(str(job / '任务.json'), {})
        assert meta['imported'] is True and meta['prompt'] == '要求' and meta['tender'] == ''
        listed = {j['job_id']: j for j in client.get('/v1/jobs').json()}
        assert body['job_id'] in listed and listed[body['job_id']]['state'] == 'stopped'
        arts = [a['name'] for a in client.get('/v1/jobs/%s/artifacts' % body['job_id']).json()]
        assert '投标文件_整册.md' in arts


def test_import_job_rejects_garbage_and_empty_packages(engine):
    with TestClient(engine.app) as client:
        assert client.post('/v1/jobs/import', files={'file': ('x.zip', b'not a zip', 'application/zip')}).status_code == 400
        empty = _zip([('a/engine.log', 'x'), ('a/.secret', 'y')])
        r = client.post('/v1/jobs/import', files={'file': ('x.zip', empty, 'application/zip')})
        assert r.status_code == 400 and '没有可导入' in r.json()['error']


# ------------------------------------------------------------------ 分册
@pytest.mark.parametrize('title, node, expected', [
    ('技术方案', 'chapter_write:01', '技术标'),
    ('售后服务方案', 'chapter_write:02', '技术标'),
    ('资格证明文件', 'chapter_write:03', '商务标'),
    ('商务应答与承诺', 'chapter_write:04', '商务标'),
    ('投标报价表', 'chapter_write:05', '报价标'),
    ('技术应答偏离表', 'chapter_write:technical_deviation', '技术标'),
    ('商务偏离表', 'chapter_write:business_deviation', '商务标'),
])
def test_volume_classification(engine, title, node, expected):
    assert engine._volume_of(title, node) == expected


def test_assemble_writes_volumes_only_when_the_job_asks(engine, tmp_path):
    job = Path(engine.jpath('vol')); job.mkdir(parents=True)
    titles = ['技术方案', '资格证明文件', '投标报价表']
    engine.write_json(str(job / '任务.json'), {'name': '分册单', 'tender': '', 'created_at': engine.now(), 'volumes': True})
    engine.generation_pipeline.initialize(job, run_id='r-vol', mode='fast', model_routes={'fast': 'm', 'quality': 'm'},
        chapters=[{'id': '%02d' % i, 'title': t, 'output': '章节_%02d_%s.md' % (i, t)} for i, t in enumerate(titles, 1)])
    outputs = ['章节_%02d_%s.md' % (i, t) for i, t in enumerate(titles, 1)]
    for t, out in zip(titles, outputs):
        (job / out).write_text('# %s\n\n%s正文。\n' % (t, t), encoding='utf-8')
    volumes = engine._build_volumes(str(job), outputs)
    assert set(volumes) == {'技术标', '商务标', '报价标'}
    assert volumes['技术标'].startswith('# 分册单 · 技术标') and '技术方案正文' in volumes['技术标']
    assert '资格证明文件正文' in volumes['商务标'] and '投标报价表正文' in volumes['报价标']
    assert '资格证明文件' not in volumes['技术标']
    # 只有两类章节时不出空册
    assert set(engine._build_volumes(str(job), outputs[:2])) == {'技术标', '商务标'}


def test_whole_book_stays_first_among_volume_deliverables(engine, job):
    for name in ('投标文件_商务标.docx', '投标文件_技术标.docx', '投标文件_整册.docx'):
        (job / name).write_bytes(b'PK\x03\x04' + b'0' * 2000)
    with TestClient(engine.app) as client:
        names = [a['name'] for a in client.get('/v1/jobs/%s/artifacts' % job.name).json()]
    docx = [n for n in names if n.endswith('.docx') and n.startswith('投标文件')]
    assert docx[0] == '投标文件_整册.docx'
    assert engine.artifact_info('投标文件_技术标.docx')['purpose'].startswith('分册交付文件')


def test_create_job_records_the_volumes_switch(engine, monkeypatch):
    monkeypatch.setattr(engine, '_generation_gate_response', lambda: None)
    with TestClient(engine.app) as client:
        r = client.post('/v1/jobs', data={'start': '0', 'name': '分册', 'volumes': '1', 'mock': '1'},
                        files={'tender': ('招标文件.md', b'# tender\n', 'text/markdown')})
        assert r.status_code == 200, r.text
        jid = r.json()['job_id']
    assert engine.read_json(str(Path(engine.jpath(jid)) / '任务.json'), {})['volumes'] is True
