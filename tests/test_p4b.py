"""P4b:规范素材直接编辑、历史标书事实抽取(人工确认后入库)、A/B 试跑对比与按任务覆盖参数。"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# ------------------------------------------------------------------ 规范素材编辑
def test_asset_text_roundtrip_and_template(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(engine, 'assets_dir', lambda: str(tmp_path / '素材库'))
    with TestClient(engine.app) as client:
        first = client.get('/v1/assets/text', params={'name': '产品能力表.md'}).json()
        assert first['exists'] is False and '| 功能 | 支持情况 | 版本要求 | 证明材料 | 可定制 | 配图 |' in first['template']
        saved = client.put('/v1/assets/text', json={'name': '产品能力表.md', 'text': '# 产品能力表\n\n| 功能 | 支持情况 |\n|---|---|\n| 权限 | 支持 |'})
        assert saved.status_code == 200 and saved.json()['ok'] is True
        again = client.get('/v1/assets/text', params={'name': '产品能力表.md'}).json()
        assert again['exists'] is True and again['text'].endswith('| 权限 | 支持 |\n')
        assert client.get('/v1/assets/text', params={'name': '../config.json'}).status_code == 400
        assert client.put('/v1/assets/text', json={'name': '图片索引.json', 'text': '{}'}).status_code == 400
        assert client.put('/v1/assets/text', json={'name': '公司介绍.md', 'text': 'x' * (2 * 1024 * 1024 + 1)}).status_code == 413


# ------------------------------------------------------------------ 事实抽取
FACTS = {'company': {'name': '某某科技有限公司', 'intro': '成立于 2010 年,专注智慧水务。'},
         'qualifications': [{'name': '建筑业企业资质', 'level': '壹级', 'issuer': '住建厅', 'valid_until': '2028-06'}],
         'performances': [{'project': '滨江管网改造', 'client': '滨江水务', 'amount': '1200 万', 'date': '2024-05', 'role': '总包'}],
         'people': [{'name': '张三', 'title': '项目经理', 'certs': '一级建造师'}]}


def test_facts_markdown_routes_company_and_cases_to_the_right_files(engine):
    out = engine._facts_to_markdown(FACTS, '过往标书.docx', '2026-09-02 10:00:00')
    assert '## 来自《过往标书.docx》 · 人工确认' in out['公司介绍.md']
    assert '- 投标人:某某科技有限公司。成立于 2010 年' in out['公司介绍.md'] and '| 张三 | 项目经理 | 一级建造师 |' in out['公司介绍.md']
    assert '### 资质证书' in out['资质与案例.md'] and '| 建筑业企业资质 | 壹级 | 住建厅 | 2028-06 |' in out['资质与案例.md']
    assert '| 滨江管网改造 | 滨江水务 | 1200 万 | 2024-05 | 总包 |' in out['资质与案例.md']
    assert engine._facts_to_markdown({'company': {}, 'qualifications': [], 'performances': [], 'people': []}, 's', 't') == {'公司介绍.md': '', '资质与案例.md': ''}


def _with_model(engine, monkeypatch, tmp_path, reply):
    monkeypatch.setattr(engine, 'assets_dir', lambda: str(tmp_path / '素材库'))
    monkeypatch.setattr(engine, 's2_conf', lambda conf=None: {'base_url': 'https://gw', 'api_key': 'k', 'model': 'm', 'verify_ssl': True})
    calls = []
    def fake_req(base, key, path, payload=None, timeout=30, verify=True):
        calls.append(payload)
        return {'choices': [{'message': {'content': reply}}]}
    monkeypatch.setattr(engine, '_openai_req', fake_req)
    return calls


def test_fact_extraction_writes_a_pending_record_and_confirmation_appends_to_canonical_files(engine, monkeypatch, tmp_path):
    calls = _with_model(engine, monkeypatch, tmp_path, '```json\n' + json.dumps(FACTS, ensure_ascii=False) + '\n```')
    sections = [('公司简介', '某某科技有限公司成立于 2010 年。' * 20), ('资质', '建筑业企业资质壹级。' * 20)]
    assert engine._start_fact_extraction('过往标书.docx', 'ab12cd34ef', sections, sync=True) is True
    assert calls and 'JSON' in calls[0]['messages'][0]['content'] and calls[0]['temperature'] == 0
    with TestClient(engine.app) as client:
        listed = client.get('/v1/assets/facts').json()
        assert listed['pending'] == 1
        rec = listed['items'][0]
        assert rec['status'] == 'pending' and rec['count'] == 4 and rec['facts']['company']['name'] == '某某科技有限公司'
        edited = dict(rec['facts']); edited['people'] = []
        done = client.post('/v1/assets/facts/%s' % rec['id'], json={'action': 'confirm', 'facts': edited}).json()
        assert done['ok'] is True and set(done['written']) == {'公司介绍.md', '资质与案例.md'}
        intro = (tmp_path / '素材库' / '公司介绍.md').read_text(encoding='utf-8')
        cases = (tmp_path / '素材库' / '资质与案例.md').read_text(encoding='utf-8')
        assert '某某科技有限公司' in intro and '张三' not in intro           # 用户摘掉的人员不入库
        assert '滨江管网改造' in cases and '建筑业企业资质' in cases
        assert client.get('/v1/assets/facts').json()['pending'] == 0
        assert client.post('/v1/assets/facts/%s' % rec['id'], json={'action': 'bogus'}).status_code == 400
        assert client.post('/v1/assets/facts/nope', json={'action': 'discard'}).status_code == 404


def test_fact_extraction_is_skipped_without_a_key_and_records_model_failures(engine, monkeypatch, tmp_path):
    monkeypatch.setattr(engine, 'assets_dir', lambda: str(tmp_path / '素材库'))
    monkeypatch.setattr(engine, 's2_conf', lambda conf=None: {'base_url': '', 'api_key': '', 'model': ''})
    assert engine._start_fact_extraction('x.docx', 'aa', [('a', '内容' * 200)], sync=True) is False
    calls = _with_model(engine, monkeypatch, tmp_path, '这不是 JSON')
    assert engine._start_fact_extraction('x.docx', 'bb', [('a', '内容' * 200)], sync=True) is True
    rec = engine._facts_list()[0]
    assert rec['status'] == 'failed' and rec['error']
    assert engine._start_fact_extraction('x.docx', 'cc', [('a', '短')], sync=True) is False     # 太短不抽


def test_ingest_starts_fact_extraction_when_a_key_is_configured(engine, monkeypatch, tmp_path):
    _with_model(engine, monkeypatch, tmp_path, json.dumps(FACTS, ensure_ascii=False))
    started = []
    monkeypatch.setattr(engine, '_start_fact_extraction', lambda fn, digest, sections, sync=False: started.append(fn) or True)
    body = ('# 公司简介\n\n' + '某某科技有限公司成立于 2010 年,专注智慧水务。\n' * 30 + '\n# 资质\n\n' + '建筑业企业资质壹级。\n' * 30)
    with TestClient(engine.app) as client:
        r = client.post('/v1/assets/ingest', files={'file': ('过往标书.md', body.encode('utf-8'), 'text/markdown')})
    assert r.status_code == 200, r.text
    assert r.json()['facts'] is True and started == ['过往标书.md']


# ------------------------------------------------------------------ A/B
def test_ab_variant_syntax_matches_the_cli(engine):
    v = engine._parse_ab_variant('deepseek-v4-flash?temperature=0.5&frequency_penalty=0.4&bogus=1')
    assert v['model'] == 'deepseek-v4-flash' and v['params'] == {'temperature': 0.5, 'frequency_penalty': 0.4}
    assert v['label'] == 'deepseek-v4-flash?frequency_penalty=0.4&temperature=0.5'
    assert engine._parse_ab_variant('  ') is None and engine._parse_ab_variant('m')['params'] == {}


def test_job_level_ab_overrides_reach_generation_params_and_model_routes(engine, tmp_path, monkeypatch):
    job = Path(engine.jpath('ab-child')); job.mkdir(parents=True)
    meta = {'name': 'x', 'tender': 't.md', 'created_at': engine.now(),
            'ab': {'group': 'g', 'label': 'v', 'model': 'm-b', 'params': {'temperature': 0.7}},
            'template_snapshot': {'package': {'outline': [{'title': '技术方案'}]}}}
    engine.write_json(str(job / '任务.json'), meta)
    conf = {'engine': {'kind': 's2', 's2_key': 'k', 's2_base_url': 'https://gw', 's2_model': 'm-a', 'generation_mode': 'fast',
                       'generation_params': {'temperature': 0.2, 'frequency_penalty': 0.1}}}
    params = engine._generation_params(conf, str(job))
    assert params['temperature'] == 0.7 and params['frequency_penalty'] == 0.1     # 只覆盖变体给的那一项
    assert engine._generation_params(conf)['temperature'] == 0.2                    # 全局默认不动
    monkeypatch.setattr(engine, '_verified_model_ids', lambda conf: ['m-a', 'm-b'])
    state = engine._initialize_generation_pipeline(str(job), meta, conf)
    assert state['model_routes']['fast'] == 'm-b' and state['model_routes']['quality'] == 'm-b'


def test_ab_run_creates_one_child_per_variant_and_reports_them(engine, tmp_path, monkeypatch):
    source = Path(engine.jpath('ab-source')); source.mkdir(parents=True)
    (source / '招标.md').write_text('# 招标\n', encoding='utf-8')
    (source / '你的要求.md').write_text('要求', encoding='utf-8')
    (source / '素材').mkdir(); (source / '素材' / '公司介绍.md').write_text('介绍', encoding='utf-8')
    engine.write_json(str(source / '任务.json'), {'name': '基准单', 'tender': '招标.md', 'created_at': engine.now(), 'prompt': 'p', 'volumes': True})
    monkeypatch.setattr(engine, '_generation_gate_response', lambda: None)
    monkeypatch.setattr(engine, '_verified_model_ids', lambda conf: ['m-a', 'm-b'])
    launched = []
    monkeypatch.setattr(engine, '_launch_job', lambda jid, job, mock='auto': launched.append(jid) or {'job_id': jid, 'mode': 'staged'})
    with TestClient(engine.app) as client:
        bad = client.post('/v1/ab/run', json={'job_id': 'ab-source', 'variants': ['m-zzz']})
        assert bad.status_code == 400 and 'm-zzz' in bad.json()['error']
        r = client.post('/v1/ab/run', json={'job_id': 'ab-source', 'variants': ['m-a', 'm-b?temperature=0.5', '']})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['ok'] is True and len(body['jobs']) == 2 and launched == body['jobs']
        child = Path(engine.jpath(body['jobs'][1]))
        meta = engine.read_json(str(child / '任务.json'), {})
        assert meta['ab'] == {'group': body['group'], 'label': 'm-b?temperature=0.5', 'model': 'm-b',
                              'params': {'temperature': 0.5}, 'source_job': 'ab-source'}
        assert meta['volumes'] is True and (child / '招标.md').is_file() and (child / '素材' / '公司介绍.md').is_file()
        assert (child / '你的要求.md').read_text(encoding='utf-8') == '要求'
        engine.write_json(str(child / 'usage.json'), {'calls': 5, 'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15, 'model': 'm-b'})
        status = client.get('/v1/ab/%s' % body['group']).json()
        assert status['ok'] is True and [row['label'] for row in status['rows']] == ['m-a', 'm-b?temperature=0.5']
        assert status['rows'][1]['usage']['total_tokens'] == 15 and status['rows'][1]['model'] == 'm-b'
        assert status['running'] is True                       # staged 子任务还没跑完
        groups = client.get('/v1/ab').json()['groups']
        assert groups and groups[0]['group'] == body['group'] and groups[0]['variants'] == ['m-a', 'm-b?temperature=0.5']
        assert client.get('/v1/ab/nope').status_code == 404
        assert client.post('/v1/ab/run', json={'job_id': 'nope', 'variants': ['m-a']}).status_code == 400
        too_many = client.post('/v1/ab/run', json={'job_id': 'ab-source', 'variants': ['m-a'] * 5})
        assert too_many.status_code == 400
