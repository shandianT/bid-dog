#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中标狗 · 本地引擎(v1 协议实现)
任务=目录:jobs/<id>/ 下的文件即全部状态(任务.json / progress.json / events.jsonl / chat.jsonl / 交付物)
运行:pip install fastapi uvicorn python-multipart && python3 engine_v1.py   # 127.0.0.1:8080
真实 agent:环境变量 AGENT_CMD 命令模板(占位符 {tender}/{out}/{materials}),不配则跑内置 mock 流程。
打包:pyinstaller -F engine_v1.py → 作为 Tauri sidecar 随安装包分发(见 BUILD.md)。
"""
import os, re, sys, ssl, json, glob, time, signal, hashlib, secrets, contextvars, uuid, shlex, shutil, zipfile, threading, subprocess, datetime, asyncio, urllib.request, urllib.error
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

ENGINE_VERSION = '0.16.0'
AUTHOR = 'FDE-家涛'
ENGINE_FEATURES = ['probe_models', 'chat_test', 'agent_binding', 'assets_ingest', 'attachments', 'rerun', 'job_cancel', 'assets_dir_config', 'cli_autofind', 'sowork_engine', 'agent_test',
                   'provider_delete', 'job_delete', 'vision_index', 'artifact_open', 'job_folder_open', 'chat_control', 'job_redo', 'job_stop', 'job_log', 'skill_evidence',
                   's2_engine', 'responses_relay', 'codex_bundled', 'agent_provision', 'preset_config',
                   'quality_gate', 'job_start', 'multi_file_job', 'models_cache', 'async_sse', 's2_quick_setup',
                   'opencode_engine', 'relay_chat_passthrough', 'opencode_bundled', 'dual_shell_provision',
                   'worklog_stream', 'stage_eta']
HERE = os.path.dirname(os.path.abspath(__file__))
def _data_root():
    env = os.environ.get('BID_HOME')
    if env: return env
    base = os.path.join(os.path.expanduser('~'), 'Documents')
    new, old = os.path.join(base, '中标狗'), os.path.join(base, '标书助手')  # 旧品牌目录名,勿被全局改名脚本替换
    if not os.path.isdir(new) and os.path.isdir(old):
        try: os.rename(old, new)          # 产品改名:老用户数据目录整体自动迁移
        except Exception: return old      # 挪不动(权限/被占用)就继续用老目录,数据优先
    return new
DATA = _data_root()
MULTIUSER = os.environ.get('BID_MULTIUSER') == '1'   # 云端网页模式:每位访客独立工作区
PASSWORD = os.environ.get('BID_PASSWORD', '')        # 设置后需口令才能访问(公网必设)
ALLOW_AGENT_CONFIG = os.environ.get('BID_ALLOW_AGENT_CONFIG') == '1'  # 云端默认禁止网页改生成引擎命令
_ws = contextvars.ContextVar('ws', default='')

def ws_root():
    w = _ws.get()
    return os.path.join(DATA, 'workspaces', w) if (MULTIUSER and w) else DATA

def _mk(p): os.makedirs(p, exist_ok=True); return p
def jobs_dir():   return _mk(os.path.join(ws_root(), 'jobs'))
def conf_path():  return os.path.join(_mk(ws_root()), 'config.json')

def assets_default(): return os.path.join(ws_root(), '素材库')

def assets_dir():
    """素材库位置:默认在数据目录,可在「素材库」面板改到任意文件夹(如公司共享盘)"""
    conf = json_quiet(conf_path())
    d = (conf.get('assets_dir') or '').strip()
    if d:
        d = os.path.expanduser(d)
        try: return _mk(d)
        except Exception: pass          # 配置的路径建不出来(盘符不在了等)→ 回落默认,不让功能瘫掉
    return _mk(assets_default())

def json_quiet(p):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return {}

def ensure_preset():
    """预置配置:给某个客户定制发包时,把 preset_config.json 放在引擎旁边(或 BID_PRESET 指定),
    首次启动自动作为 config.json 种子——客户拿到手连 Key 都不用填。
    只在还没有配置时生效,绝不覆盖用户已有设置;公开发布包里不放这个文件。"""
    cp = os.path.join(_mk(DATA), 'config.json')
    if os.path.isfile(cp): return
    cands = [os.environ.get('BID_PRESET', '')]
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass: cands.append(os.path.join(meipass, 'preset_config.json'))
    cands += [os.path.join(os.path.dirname(os.path.abspath(sys.executable)), 'preset_config.json'),
              os.path.join(HERE, 'preset_config.json')]
    for c in cands:
        if c and os.path.isfile(c):
            data = json_quiet(c)
            if data:
                write_json(cp, data)
                return

app = FastAPI(title='bid-dog-engine')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

# ---------- 云端网页模式:口令门 + 访客工作区隔离(桌面版不设 BID_PASSWORD 则完全不生效) ----------
def _tok(pw): return hashlib.sha256(('bid-assistant|' + pw).encode()).hexdigest()[:32]

LOGIN_HTML = """<!doctype html><meta charset=utf-8><title>中标狗</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221024%22 height=%221024%22 viewBox=%220 0 1024 1024%22%3E%3Cdefs%3E%3ClinearGradient id=%22bg%22 x1=%220%22 y1=%220%22 x2=%220%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%231274e0%22/%3E%3Cstop offset=%221%22 stop-color=%22%230a55aa%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%221024%22 height=%221024%22 rx=%22232%22 fill=%22url(%23bg)%22/%3E%3Cg fill=%22%23ffffff%22%3E%3C!-- %E7%AB%8B%E8%80%B3:%E5%A4%B4%E9%A1%B6%E5%81%8F%E5%86%85,%E5%9C%86%E8%A7%92%E4%B8%89%E8%A7%92,%E6%9F%B4%E7%8A%AC%E6%84%9F --%3E%3Cpath d=%22M 344 332 L 322 172 Q 318 140 350 152 L 472 218 Q 430 252 344 332 Z%22/%3E%3Cpath d=%22M 680 332 L 702 172 Q 706 140 674 152 L 552 218 Q 594 252 680 332 Z%22/%3E%3C!-- %E8%84%B8:%E7%95%A5%E5%AE%BD%E6%A4%AD%E5%9C%86 --%3E%3Cellipse cx=%22512%22 cy=%22490%22 rx=%22270%22 ry=%22250%22/%3E%3C/g%3E%3C!-- %E4%BA%94%E5%AE%98 --%3E%3Cg fill=%22%230a55aa%22%3E%3Ccircle cx=%22418%22 cy=%22448%22 r=%2232%22/%3E%3Ccircle cx=%22606%22 cy=%22448%22 r=%2232%22/%3E%3Cellipse cx=%22512%22 cy=%22560%22 rx=%2250%22 ry=%2238%22/%3E%3C/g%3E%3C!-- %E5%90%90%E8%88%8C:%E7%8B%97%E7%9A%84%E8%BA%AB%E4%BB%BD%E8%AF%81 --%3E%3Cpath d=%22M 512 596 L 512 640 Q 512 706 470 706 Q 442 706 442 676 Q 442 662 452 654%22 fill=%22none%22/%3E%3Cpath d=%22M 456 618 Q 456 700 512 700 Q 568 700 568 618 Q 540 636 512 636 Q 484 636 456 618 Z%22 fill=%22%23ff8da1%22/%3E%3C!-- %E4%B8%AD%E6%A0%87%E5%8D%B0%E7%AB%A0:%E5%8F%B3%E4%B8%8B%E8%A7%92%E7%BB%BF%E7%AB%A0 %2B %E5%AF%B9%E5%8B%BE --%3E%3Cg%3E%3Ccircle cx=%22768%22 cy=%22752%22 r=%22148%22 fill=%22%2323a55a%22 stroke=%22%23ffffff%22 stroke-width=%2226%22/%3E%3Cpath d=%22M 700 752 L 750 806 L 840 692%22 stroke=%22%23ffffff%22 stroke-width=%2242%22 fill=%22none%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/g%3E%3C/svg%3E">
<style>body{font-family:-apple-system,"PingFang SC","Segoe UI",sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#fbfbfd;color:#1d1d1f}
form{background:#fff;padding:38px 40px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);width:320px}
h1{font:600 20px/1.3 inherit;margin:0 0 8px}p{font:400 13px/1.6 inherit;color:#6e6e73;margin:0 0 20px}
input{width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:11px 12px;font:400 14px inherit;outline:none}
input:focus{border-color:#0a63c9}button{width:100%;margin-top:12px;border:0;border-radius:999px;background:#0a63c9;
color:#fff;font:500 14px inherit;padding:11px;cursor:pointer}button:hover{background:#0a55aa}
.e{color:#c0392b;font:400 12.5px inherit;margin-top:10px}</style>
<form method=post action=/login><h1>中标狗</h1><p>请输入访问口令</p>
<input name=password type=password placeholder="访问口令" autofocus><button>进入</button>__ERR__</form>"""

def login_page(err='', code=200):
    return HTMLResponse(LOGIN_HTML.replace('__ERR__', '<div class=e>口令不正确</div>' if err else ''), status_code=code)

@app.post('/login')
async def login(request: Request):
    form = await request.form()
    if PASSWORD and form.get('password') != PASSWORD:
        return login_page(err='1', code=401)
    r = RedirectResponse('/', status_code=303)
    r.set_cookie('bid_auth', _tok(PASSWORD), max_age=30 * 86400, httponly=True, samesite='lax')
    r.set_cookie('bid_uid', request.cookies.get('bid_uid') or secrets.token_hex(8), max_age=365 * 86400, httponly=True, samesite='lax')
    return r

@app.middleware('http')
async def gate(request: Request, call_next):
    uid = request.cookies.get('bid_uid') or (secrets.token_hex(8) if MULTIUSER else '')
    _ws.set(uid)
    # /v1/relay/* 是给本机 Codex 用的,它没有浏览器 Cookie,自己带 relay_token 鉴权,不走口令门
    if (PASSWORD and request.url.path not in ('/login', '/v1/health')
            and not request.url.path.startswith('/v1/relay/')
            and request.cookies.get('bid_auth') != _tok(PASSWORD)):
        if request.url.path.startswith('/v1/'):
            return JSONResponse({'error': 'unauthorized', 'login': '/'}, status_code=401)
        return login_page()
    resp = await call_next(request)
    if MULTIUSER and uid and not request.cookies.get('bid_uid'):
        resp.set_cookie('bid_uid', uid, max_age=365 * 86400, httponly=True, samesite='lax')
    return resp

def now(): return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
def jpath(jid): return os.path.join(jobs_dir(), os.path.basename(jid))
def read_json(p, dft):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return dft
def write_json(p, obj):
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)

def emit(job, ev):
    """事件即真相:UI 全部状态只依赖 events.jsonl 这一条流。任务目录已被删除(用户删任务)则静默丢弃"""
    if not os.path.isdir(job): return
    ev['ts'] = now()
    try:
        with open(os.path.join(job, 'events.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(ev, ensure_ascii=False) + '\n')
        if ev['type'] == 'progress':
            write_json(os.path.join(job, 'progress.json'), ev)
    except FileNotFoundError:
        pass

STAGES = ['体检素材', '图片入库', '读懂组成', '提取格式', '评分废标', '拆解分工',
          '分章撰写', '逐条应答', '汇总成册', '配图复核', '自查体检', '出Word门禁']

def mock_agent(job):
    """内置模拟 agent:走完 12 阶段,发问一次,产出样例交付物 —— 演示与前端联调用"""
    RUNNING.add(os.path.basename(job))
    try:
        _mock_agent(job)
    finally:
        RUNNING.discard(os.path.basename(job))
        CANCEL.discard(os.path.basename(job))

def _cancelled(job): return os.path.basename(job) in CANCEL or not os.path.isdir(job)

def _mock_agent(job):
    emit(job, {'type': 'message', 'role': 'agent', 'text': '收到招标文件,开始读。读完我会把结构、评分表和要你确认的事列出来。'})
    for i, st in enumerate(STAGES):
        if _cancelled(job): return            # 任务被删:立即收工
        if read_json(os.path.join(job, '任务.json'), {}).get('paused'):
            while read_json(os.path.join(job, '任务.json'), {}).get('paused'):
                if _cancelled(job): return
                time.sleep(1)
        pct = int((i + 0.5) / len(STAGES) * 100)
        emit(job, {'type': 'progress', 'stage': st, 'pct': pct, 'step': i + 1, 'total': len(STAGES)})
        emit(job, {'type': 'worklog', 'lines': ['[%s] 开始:读取上一步产物,校验输入齐全' % st,
                                                '$ 正在执行 %s 相关脚本与分析…' % st]})
        if st == '评分废标':
            emit(job, {'type': 'question', 'id': 'q1', 'text': '评分表要求安全生产许可证在有效期内;素材库那份 2026-06 到期。等你上传新证,还是按「即将换证」写?',
                       'options': ['等我上传新证', '按即将换证写']})
        if st == '分章撰写':
            emit(job, {'type': 'message', 'role': 'agent', 'text': '六章已分给子 agent 并行写,写完逐章汇报。'})
            for ch in range(1, 7):
                time.sleep(1.2); emit(job, {'type': 'chapter', 'no': ch, 'state': 'done', 'pages': 6 + ch * 3})
        time.sleep(1.5)
    for fn, txt in [('投标文件_技术标.md', '# 投标文件(技术标)\n\n(mock 交付物,接真实 agent 后为完整标书)\n'),
                    ('投标文件自检报告.md', '# 自检报告\n\n结论:仅可作初稿\n\n## 需人工确认\n- 投标人名称\n- 报价\n- 安全生产许可证新件\n')]:
        open(os.path.join(job, fn), 'w', encoding='utf-8').write(txt)
        emit(job, {'type': 'artifact', 'name': fn})
    emit(job, {'type': 'progress', 'stage': '完成', 'pct': 100, 'step': 12, 'total': 12})
    summary, actions = artifact_summary(job)
    emit(job, {'type': 'message', 'role': 'agent', 'text': summary + '\n\n演示流程只生成样例稿；真实 Word 需要绑定生成引擎。', 'actions': actions})
    emit(job, {'type': 'health', 'level': 'yellow', 'summary': '3 项人工确认后即可投',
               'gaps': [{'level': 'red', 'title': '投标人名称与报价未填', 'detail': '封面与投标函两处占位符'},
                        {'level': 'yellow', 'title': '安全生产许可证 2026-06 到期', 'detail': '评分表要求有效期内'},
                        {'level': 'yellow', 'title': '项目经理业绩缺一份中标通知书', 'detail': '要求近三年 2 个同类业绩'},
                        {'level': 'green', 'title': '格式门禁全部通过', 'detail': '字体/行距/页边距/页码合规'}]})

DELIVER_EXT = ('.md', '.docx', '.xlsx', '.pdf')

def list_deliverables(job):
    meta = read_json(os.path.join(job, '任务.json'), {})
    tender = meta.get('tender', '')
    out = []
    for fn in sorted(os.listdir(job)):
        if fn.endswith(DELIVER_EXT) and not fn.startswith(('_', '.')) and fn != tender:
            out.append(fn)
    return out

def artifact_info(fn):
    """给 UI 的稳定产物说明:不靠前端猜文件用途,同名规则在桌面/网页都一致。"""
    low, ext = fn.lower(), os.path.splitext(fn)[1].lower()
    if ext in ('.docx', '.xlsx', '.pdf'):
        group, kind, rank = 0, {'.docx': 'WORD', '.xlsx': 'EXCEL', '.pdf': 'PDF'}[ext], 10
        if ext == '.docx' and ('完整' in fn or '投标文件' in fn):
            purpose, rank = '主要交付文件：可编辑的完整投标文件，提交前请人工复核、签字和盖章。', 0
        elif ext == '.xlsx':
            purpose = '可编辑的表格附件，用于核对清单、报价或响应数据。'
        elif ext == '.pdf':
            purpose = '便于预览或提交的 PDF 文件，请核对页面与盖章要求。'
        else:
            purpose = 'Word 交付文件，可直接打开检查内容和排版。'
    elif any(k in fn for k in ('自检', '门禁', '检查报告', '废标风险', '补料清单')):
        group, kind, rank = 1, ('报告' if '报告' in fn or '自检' in fn else '清单'), 10
        if '格式' in fn or '门禁' in fn:
            purpose, rank = '格式检查结果：核对字体、页边距、目录、页码与表格版式。', 0
        elif '补料' in fn:
            purpose, rank = '待补材料清单：列出提交前仍需补齐或确认的事实材料。', 1
        elif '废标' in fn:
            purpose, rank = '高风险事项清单：提交前逐条排除可能导致废标的问题。', 2
        else:
            purpose, rank = '内容自检报告：查看缺失项、风险项和需要人工确认的结论。', 0
    elif any(k in fn for k in ('响应矩阵', '响应对照', '偏离表', '评分', '格式要求', '解析版', '配图清单', '组成')):
        group, kind, rank = 2, '分析', 10
        if '响应矩阵' in fn or '响应对照' in fn:
            purpose, rank = '响应依据：对照招标要求、评分点与标书章节，检查是否逐条覆盖。', 0
        elif '偏离表' in fn:
            purpose, rank = '偏离核对：集中查看商务或技术响应与招标要求的差异。', 1
        elif '评分' in fn:
            purpose, rank = '评分分析：核对评分标准、得分证据和对应章节。', 2
        elif '解析版' in fn:
            purpose = '招标文件解析文本，供 Agent 分析和追溯原始要求。'
        elif '配图' in fn:
            purpose = '配图计划：说明图片素材及其建议插入位置。'
        else:
            purpose = '分析依据文件，用于复核要求、格式和响应关系。'
    else:
        group, kind, rank = 3, ('稿件' if ext == '.md' else ext.lstrip('.').upper()), 10
        purpose = '过程稿件：用于追溯和继续编辑，通常无需作为最终交付提交。'
    return {'group': group, 'kind': kind, 'purpose': purpose, 'rank': rank}

def artifact_summary(job, names=None):
    names = sorted(names or list_deliverables(job),
                   key=lambda n: (artifact_info(n)['group'], artifact_info(n)['rank'], n))
    primary = next((n for n in names if artifact_info(n)['group'] == 0 and n.lower().endswith('.docx')), None)
    checks = [n for n in names if artifact_info(n)['group'] == 1]
    lines = ['任务完成，已整理好 **%d 个文件**。' % len(names), '', '**建议按这个顺序查看：**']
    if primary: lines.append('1. `%s` — 最终 Word，先检查内容与排版。' % primary)
    if checks: lines.append('%d. `%s` — 查看风险、缺项和人工确认事项。' % (2 if primary else 1, checks[0]))
    lines += ['', '其他分析依据和过程稿件已收纳在右侧“已产出”，点击文件旁的“打开”即可直接查看。']
    actions = []
    if primary: actions.append({'act': 'open_artifact', 'label': '打开最终 Word', 'file': primary})
    actions.append({'act': 'open_job_folder', 'label': '打开任务文件夹'})
    return '\n'.join(lines), actions

# 12 步默认预估秒数(没有本机历史时的参考值;有历史后用滚动平均逐步替代)
STAGE_DEFAULT_S = [60, 120, 150, 60, 150, 150, 900, 300, 180, 60, 120, 150]

def stage_stats_path(): return os.path.join(DATA, 'stage_stats.json')

def record_stage(step, dur):
    """某一步真实耗时入库:EWMA 滚动平均,预计时间越用越准"""
    if not (1 <= step <= 12) or dur <= 0 or dur > 3 * 3600: return
    st = read_json(stage_stats_path(), {})
    k = str(step)
    cur = st.get(k) or {}
    avg = cur.get('avg')
    st[k] = {'avg': round(dur if avg is None else 0.6 * avg + 0.4 * dur, 1), 'n': int(cur.get('n', 0)) + 1}
    try: write_json(stage_stats_path(), st)
    except Exception: pass

@app.get('/v1/stats/stages')
def stage_stats():
    """前端算「预计还剩」用:每步平均耗时(本机历史优先,缺的用默认参考值)"""
    st = read_json(stage_stats_path(), {})
    avgs = []
    for i in range(1, 13):
        h = st.get(str(i))
        avgs.append({'step': i, 'avg_s': (h or {}).get('avg') or STAGE_DEFAULT_S[i - 1],
                     'from_history': bool(h)})
    return {'stages': avgs}

# 工作台词过滤:agent 的原始输出噪声很大,只留人能看懂的动作行
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')
_WORKLOG_SKIP = re.compile(r'^(session id|reasoning|workdir|model:|provider|approval|sandbox|tokens used|'
                           r'-{5,}|> build|user$|codex$|exec$|thinking$|mcp|WARNING|warning:|To view this session)')

def worklog_clean(chunk):
    out = []
    for ln in chunk.splitlines():
        ln = _ANSI_RE.sub('', ln).strip()
        if not ln or _WORKLOG_SKIP.match(ln): continue
        if len(ln) > 160: ln = ln[:157] + '…'
        out.append(ln)
    return out

RUNNING = set()   # 正在跑 agent 的任务(mock 与真实都算,用于判断对话有没有人接收)
CANCEL = set()    # 用户删除的任务:通知执行线程立即收工
PROCS = {}        # jid → 真实 agent 的 Popen 句柄(删除任务时用来杀进程)

# GUI 方式启动的 App(Finder/Dock 双击)继承不到 shell 的 PATH,Homebrew/npm 装的 CLI 会"明明装了却找不到"。
# 解决:按增补 PATH 查找 + 扫常见安装位置,拿绝对路径执行。
EXTRA_BIN = [os.path.expanduser(p) for p in (
    '/opt/homebrew/bin', '/usr/local/bin', '~/.local/bin', '~/bin', '~/.npm-global/bin',
    '~/.claude/local', '~/.codex/bin', '~/.nvm/current/bin', '/opt/node22/bin')]
if os.name == 'nt':
    EXTRA_BIN += [os.path.join(os.environ.get('APPDATA', ''), 'npm'),
                  os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'claude')]

def aug_path_env():
    env = {**os.environ, **shell_env_snapshot()}
    env['PATH'] = os.pathsep.join([p for p in EXTRA_BIN if os.path.isdir(p)]
                                  + [env.get('PATH', ''), os.environ.get('PATH', '')])
    return env

# SoWork(商汤)桌面端自带的 openclaw CLI:装在 App 包内,不在 PATH 上,得按包路径找
# 子进程与本会话解绑:POSIX 用新会话;Windows 不开控制台窗口
DETACH = {'start_new_session': True} if os.name != 'nt' else {'creationflags': 0x08000000}

SOWORK_GLOBS = [
    # 应用名可能是「商汤输入法SoWork.app」「SoWork.app」等,CLI 也可能不在 Resources/cli 下,
    # 所以既按常见路径直取,也在包内递归找一层
    '/Applications/*SoWork*.app/Contents/Resources/cli/openclaw',
    '/Applications/*商汤*.app/Contents/Resources/cli/openclaw',
    os.path.expanduser('~/Applications/*SoWork*.app/Contents/Resources/cli/openclaw'),
    os.path.expanduser('~/Applications/*商汤*.app/Contents/Resources/cli/openclaw'),
    '/Applications/*SoWork*.app/Contents/**/openclaw',
    '/Applications/*商汤*.app/Contents/**/openclaw',
    os.path.expanduser('~/Applications/*SoWork*.app/Contents/**/openclaw'),
    os.path.expanduser('~/Applications/*商汤*.app/Contents/**/openclaw'),
    os.path.join(os.environ.get('LOCALAPPDATA', '') or '_', 'Programs', '**', 'openclaw.exe'),
    os.path.join(os.environ.get('APPDATA', '') or '_', '**', 'openclaw.exe'),
]

def bundled_cli(base):
    """安装包内置的执行外壳(Tauri externalBin,打包后去掉平台三元组后缀,与引擎同目录):
    优先级最高的"客户免装任何东西"来源;其次是「一键安装」下载到数据目录的那份(版本钉过、测过兼容)"""
    exe = base + ('.exe' if os.name == 'nt' else '')
    dirs = [os.path.dirname(os.path.abspath(sys.executable)),   # PyInstaller sidecar:与主程序同目录
            os.path.dirname(os.path.abspath(sys.argv[0] or '.')), HERE]
    for d in dirs:
        c = os.path.join(d, exe)
        if os.path.isfile(c): return c
    c = os.path.join(DATA, 'bin', exe)                          # 「一键安装」落点
    return c if os.path.isfile(c) else None

def bundled_codex():
    return bundled_cli('codex-cli')

CLI_FAMILY = {'codex': ('codex',), 'claude': ('claude',), 'opencode': ('opencode',),
              'sowork': ('openclaw', 'sowork'), 'openclaw': ('openclaw', 'sowork')}

def resolve_cli(name, eng=None):
    """找 CLI 的绝对路径:显式配置(仅当文件名与工具同族)> 内置/一键安装 > 增补 PATH > 常见安装位置。
    显式路径带族校验的原因:「CLI 路径」是共享字段,切换引擎后旧路径会指向另一个工具——
    曾把 codex 二进制当 opencode 跑出 unexpected argument '--auto'(真机事故)。名字对不上就当没填。"""
    if eng and (eng.get('cli_path') or '').strip():
        p = os.path.expanduser(eng['cli_path'].strip())
        fam = CLI_FAMILY.get(name)
        base = os.path.basename(p).lower()
        if os.path.isfile(p) and (not fam or any(k in base for k in fam)):
            return p
    if name == 'codex':
        b = bundled_cli('codex-cli')
        if b: return b
    if name == 'opencode':
        b = bundled_cli('opencode-cli')
        if b: return b
    if name in ('sowork', 'openclaw'):
        for pat in SOWORK_GLOBS:
            if not pat: continue
            hits = sorted(glob.glob(pat, recursive=True))
            if hits: return hits[0]
        name = 'openclaw'
    p = shutil.which(name, path=aug_path_env()['PATH'])
    if p: return p
    exe = name + ('.exe' if os.name == 'nt' else '')
    for d in EXTRA_BIN:
        c = os.path.join(d, exe)
        if os.path.isfile(c): return c
    return None

_SHELL_ENV = {}
_SHELL_ENV_DONE = [False]
SKIP_ENV_KEYS = {'_', 'PWD', 'OLDPWD', 'SHLVL', 'PS1', 'TERM', 'COLUMNS', 'LINES'}

def shell_env_snapshot():
    """GUI 双击启动的 App 不继承终端环境(PATH、CLI 网关配置等全丢)。
    跑一次「登录+交互」shell 抓取用户真实环境变量再合并进子进程——
    比把命令塞进 shell 里执行更稳:能读到 .zshrc,又不会把 rc 的输出混进 agent 结果。"""
    if _SHELL_ENV_DONE[0] or os.name == 'nt': return _SHELL_ENV
    _SHELL_ENV_DONE[0] = True
    sh = os.environ.get('SHELL') or '/bin/zsh'
    if not os.path.isfile(sh): sh = '/bin/bash'
    for args in ([sh, '-lic', 'env'], [sh, '-lc', 'env']):     # 交互式读不到就退回登录式
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
            for ln in (r.stdout or '').splitlines():
                if '=' not in ln: continue
                k, v = ln.split('=', 1)
                if k.isidentifier() and k not in SKIP_ENV_KEYS: _SHELL_ENV[k] = v
            if _SHELL_ENV: break
        except Exception: pass
    return _SHELL_ENV

def login_shell_wrap(cmd, eng):
    """环境已由 shell_env_snapshot 继承,命令直接执行即可(保留此函数供调用点统一)"""
    return cmd

def agent_env(eng=None):
    """子进程环境 = 应用环境 < 登录 shell 快照 < 增补 PATH < 用户填的附加环境变量(优先级从低到高)"""
    eng = eng or {}
    env = {**os.environ}
    if eng.get('login_shell') is not False:
        env.update(shell_env_snapshot())          # 终端里有、App 里没有的,以终端为准
    paths = [p for p in EXTRA_BIN if os.path.isdir(p)]
    env['PATH'] = os.pathsep.join(paths + [env.get('PATH', ''), os.environ.get('PATH', '')])
    if (eng.get('kind') or '') == 's2':
        try: env.update(s2_env(eng))                           # S2 引擎:换成我们自己的 CODEX_HOME 与 Key
        except Exception: pass
    if (eng.get('kind') or '') == 'opencode':
        try: env.update(opencode_env(eng))                     # opencode 外壳:隔离 XDG + 直通端点口令
        except Exception: pass
    for ln in (eng.get('env') or '').splitlines():
        ln = ln.strip()
        if not ln or ln.startswith('#') or '=' not in ln: continue
        k, v = ln.split('=', 1)
        env[k.strip()] = os.path.expanduser(v.strip())         # 用户显式指定的最高优先
    return env

def ensure_line_ts(job):
    """给 agent 自写的、没有 ts 的事件行补时间戳并持久化。
       由 watcher 每几秒调用一次 → 即使没人开着页面,阶段耗时也是真实的。"""
    path = os.path.join(job, 'events.jsonl'); tsf = os.path.join(job, '.line_ts.json')
    if not os.path.isfile(path): return {}
    index = read_json(tsf, {}); dirty = False
    try: lines = open(path, encoding='utf-8').read().splitlines()
    except Exception: return index
    for i, ln in enumerate(lines):
        if str(i) in index: continue
        try: e = json.loads(ln)
        except Exception: continue
        if e.get('ts'): continue
        index[str(i)] = now(); dirty = True
    if dirty:
        try: write_json(tsf, index)
        except Exception: pass
    return index

def _skill_module(name):
    """从技能包 references/ 里加载确定性脚本(quality_gate / build_tender_docx 等)。
    单一事实来源:引擎不复制这些逻辑,升级技能包 = 引擎门禁同步升级。"""
    sd = skill_dir_conf()
    if not os.path.isfile(os.path.join(sd, 'SKILL.md')): sd = ensure_skill()
    path = os.path.join(sd, 'references', name + '.py')
    if not os.path.isfile(path): return None
    try:
        import importlib.util
        refs = os.path.dirname(path)
        if refs not in sys.path: sys.path.insert(0, refs)   # 脚本之间互相 import(tender_images 等)
        spec = importlib.util.spec_from_file_location('skillref_' + name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None

def _job_find(job, *pats):
    """在任务目录(含一层子目录)找第一个命中文件"""
    for base in [job] + [os.path.join(job, d) for d in sorted(os.listdir(job))
                         if os.path.isdir(os.path.join(job, d)) and not d.startswith(('.', '_'))]:
        for pat in pats:
            hits = sorted(glob.glob(os.path.join(base, pat)))
            if hits: return hits[0]
    return None

def quality_audit(job, known):
    """完成后的确定性质检 + 自动修复 + 重出 Word(引擎兜底,不管模型有没有自觉跑过):
    图片按索引锚点搬正/补插/剔除、重复段折叠、按章字数、应答覆盖率 → 《成品质检报告》。
    修复动作真实发生时,用修复稿重建 docx(build_tender_docx,零 token)——给客户看的必须是修好的 Word。"""
    qg = _skill_module('quality_gate')
    if not qg: return content_gate(job, known)          # 老技能目录没有质检脚本:退回旧内容门禁
    mdir = os.path.join(job, '素材')
    mat = mdir if os.path.isdir(mdir) else assets_dir()
    score = _job_find(job, '评分点响应矩阵.md')
    devs = [p for p in [_job_find(job, '技术应答偏离表.md'), _job_find(job, '商务偏离表.md')] if p]
    mds = [fn for fn in sorted(known) if fn.endswith('.md') and fn.startswith('投标')
           and not any(k in fn for k in ('自检', '清洗', '报告', '.bak'))]
    if not mds: return content_gate(job, known)
    worst, fixed_total, lines = 'green', 0, []
    order = {'green': 0, 'yellow': 1, 'red': 2}
    for fn in mds:
        mp = os.path.join(job, fn)
        try:
            res = qg.audit(mp, materials=mat, min_chapter=3500, score=score, deviations=devs)
            fixed, pre_images = None, None
            if res['plan'] or any(l == 'red' and ('打散' in t or '重复' in t) for l, t in res['items']):
                pre_images = res['images']
                fixed = qg.apply_fix(mp, res)
                fixed_total += fixed or 0
                res = qg.audit(mp, materials=mat, min_chapter=3500, score=score, deviations=devs)
            try: qg.write_report(os.path.join(job, '成品质检报告.md'), fn, res, fixed, images_pre=pre_images)
            except TypeError: qg.write_report(os.path.join(job, '成品质检报告.md'), fn, res, fixed)
            if order[res['level']] > order[worst]: worst = res['level']
            icon = {'green': '✅', 'yellow': '🟡', 'red': '🔴'}[res['level']]
            lines.append('%s %s:%d 章共 %d 字' % (icon, fn, len(res['chapters']), res['total_chars']))
            for l, t in res['items'][:4]:
                lines.append(('  🔴 ' if l == 'red' else '  🟡 ') + t)
            if fixed: lines.append('  🔧 已自动修复 %d 处(图片落位/重复段),原稿备份 *.bak.md' % fixed)
        except Exception as e:
            lines.append('⚠ %s 质检异常:%s' % (fn, e)); continue
    emit(job, {'type': 'artifact', 'name': '成品质检报告.md'})
    # 修复真的动了内容 → 用修复稿重建 Word(客户拿到手的必须是修好的那份)
    if fixed_total:
        bt = _skill_module('build_tender_docx')
        spec_f = _job_find(job, 'word_format_spec.json')
        meta = read_json(os.path.join(job, '任务.json'), {})
        for fn in mds:
            stem = os.path.splitext(fn)[0]
            # 目标 docx:同名优先;唯一一个 docx 交付物也认(模型常把 投标文件_技术标.md 出成 技术标.docx)
            docxs = [x for x in known if x.endswith('.docx')]
            target = (stem + '.docx') if (stem + '.docx') in known else (docxs[0] if len(docxs) == 1 else stem + '.docx')
            if not bt: break
            try:
                argv = [os.path.join(job, fn), os.path.join(job, target),
                        '--title', str(meta.get('name') or stem), '--images-dir', mat]
                if spec_f: argv += ['--format-spec', spec_f]
                sub = (meta.get('name') or '')
                old_argv = sys.argv
                sys.argv = ['build_tender_docx.py'] + argv
                try: bt.main()
                finally: sys.argv = old_argv
                emit(job, {'type': 'artifact', 'name': target})
                lines.append('🔁 已用修复稿重新导出 %s(图片已按锚点落位)' % target)
            except SystemExit:
                pass
            except Exception as e:
                lines.append('⚠ 重建 %s 失败:%s(md 修复稿仍有效)' % (target, e))
    verdict = {'green': '✅ 成品质检通过', 'yellow': '🟡 成品质检:有建议项(见《成品质检报告.md》)',
               'red': '🔴 成品质检:有必须处理项——按报告处理或对相应章节「定向重做」后再交付'}[worst]
    emit(job, {'type': 'message', 'role': 'agent', 'text': verdict + '\n\n' + '\n'.join(lines[:14]),
               'actions': [{'act': 'open_artifact', 'label': '打开质检报告', 'file': '成品质检报告.md'}]
                          + ([{'act': 'open_redo', 'label': '定向重做不达标章节'}] if worst == 'red' else [])})
    if worst == 'red':
        emit(job, {'type': 'health', 'level': 'red', 'summary': '成品质检有必须处理项',
                   'gaps': [{'level': 'red', 'title': '见《成品质检报告.md》',
                             'detail': '字数/图片落位/重复段/应答覆盖率的逐项详情都在报告里'}]})

def content_gate(job, names):
    """内容门禁:格式自检只管版式,这里管正文是否被逐字打散/重复灌注,坏了不静默交付"""
    try:
        import doc_quality as dq
    except Exception:
        return
    gaps, bad = [], []
    for fn in sorted(names):
        if not fn.endswith(('.md', '.docx')): continue
        try:
            r = dq.detect(dq.read_any(os.path.join(job, fn)))
        except Exception:
            continue
        for i in r.get('issues', []):
            bad.append(fn)
            gaps.append({'level': 'red', 'title': '%s:%s' % (fn, i['title']), 'detail': i['detail']})
    if gaps:
        emit(job, {'type': 'message', 'role': 'agent',
                   'text': '⚠ 内容门禁未通过:%s 存在正文被逐字打散或整段重复灌注的问题,直接交付会是废稿。'
                           '可在「出件前检查」点「一键修复」自动清洗后重新出 Word。' % '、'.join(sorted(set(bad)))})
        emit(job, {'type': 'health', 'level': 'red', 'summary': '内容异常,需修复后再出件',
                   'gaps': gaps[:8] + [{'level': 'green', 'title': '可一键修复', 'detail': '合并逐字碎片、折叠重复样板后重新导出'}]})

@app.post('/v1/jobs/{jid}/repair')
def repair_job(jid: str):
    """一键修复:清洗 md 交付物(逐字碎片合并、重复样板折叠),生成 *_已清洗.md"""
    import doc_quality as dq
    job = jpath(jid); fixed = []
    for fn in sorted(list_deliverables(job)):
        if not fn.endswith(('.md', '.docx')) or '已清洗' in fn: continue
        p = os.path.join(job, fn)
        try:
            src = dq.read_any(p)
            if dq.detect(src).get('ok'): continue
            out = os.path.join(job, os.path.splitext(fn)[0] + '_已清洗.md')
            open(out, 'w', encoding='utf-8').write(dq.repair(src))
            fixed.append(os.path.basename(out))
            emit(job, {'type': 'artifact', 'name': os.path.basename(out)})
        except Exception as e:
            emit(job, {'type': 'error', 'text': '修复 %s 失败:%s' % (fn, e)})
    emit(job, {'type': 'message', 'role': 'agent',
               'text': ('已清洗:%s。请核对内容后用清洗版重新出 Word。' % '、'.join(fixed)) if fixed else '未发现需要清洗的内容异常。'})
    return {'ok': True, 'fixed': fixed}

def kill_tree(p):
    """子进程跑在独立会话里:必须杀整个进程组,而且父进程先死不代表子孙也死了——
    所以先记住进程组号,SIGTERM 之后无条件再补一次 SIGKILL(组已消失时忽略即可)。"""
    if not p: return
    try: pgid = os.getpgid(p.pid)
    except Exception: pgid = None
    if os.name == 'nt':
        try: p.kill()
        except Exception: pass
        return
    for sig, wait_s in ((signal.SIGTERM, 4), (signal.SIGKILL, 2)):
        if pgid:
            try: os.killpg(pgid, sig)
            except ProcessLookupError: pass
            except Exception: pass
        try: p.wait(wait_s)
        except Exception: pass
        if sig is signal.SIGTERM and pgid:
            try:            # 组里还有活口(父死子活)就继续走 SIGKILL
                os.killpg(pgid, 0)
            except Exception:
                return

def read_tail(path, n=800):
    try: return open(path, encoding='utf-8', errors='ignore').read()[-n:]
    except Exception: return ''

SKILL_MARKS = ['SKILL.md', 'bid-multiagent', 'build_tender_docx', 'check_docx_format',
               'fill_tender_template', '格式门禁', '响应矩阵']

def skill_evidence(job):
    """技能包到底有没有被用上——只认硬证据:日志里读过 SKILL.md/跑过门禁脚本,或产出里有门禁报告。
    没有证据就如实说「没用上」,不粉饰:这是产出质量差最常见的根因。"""
    log = read_tail(os.path.join(job, 'run.log'), 200000)
    hits = [m for m in SKILL_MARKS if m in log]
    try:
        files = os.listdir(job)
    except Exception:
        files = []
    if any(('格式自检' in f or '门禁' in f) for f in files): hits.append('产出含格式自检报告')
    if hits: return {'ok': True, 'hits': hits, 'why': ''}
    why = '运行日志里没有出现 SKILL.md、门禁脚本或响应矩阵等任何技能包痕迹'
    if not log: why = '没有拿到运行日志,无法确认(agent 可能没有输出)'
    return {'ok': False, 'hits': [], 'why': why}

def real_agent(job, cmd):
    RUNNING.add(os.path.basename(job))
    log = open(os.path.join(job, 'run.log'), 'a', encoding='utf-8')
    emit(job, {'type': 'message', 'role': 'agent', 'text': '真实 agent 已启动,进度见事件流。'})
    stop = threading.Event(); known = set(list_deliverables(job))
    def watcher():
        """运行中桥接:新交付物→artifact 事件;progress→progress.json;
        run.log 增量→流式「工作台词」事件(用户最缺的就是'它此刻在干嘛'的文字反馈);
        步进切换→上一步真实耗时入库(预计等待时间的数据来源)。"""
        ev_path = os.path.join(job, 'events.jsonl')
        log_path = os.path.join(job, 'run.log')
        log_off = [0]; cur_step = [0]; step_t0 = [time.time()]
        while not stop.wait(4):
            try:
                ensure_line_ts(job)      # agent 写的进度行实时打戳
                for ln in reversed(open(ev_path, encoding='utf-8').read().splitlines()):
                    e = json.loads(ln)
                    if e.get('type') == 'progress':
                        write_json(os.path.join(job, 'progress.json'), e)
                        stp = int(e.get('step') or 0)
                        if stp != cur_step[0]:
                            if cur_step[0]: record_stage(cur_step[0], time.time() - step_t0[0])
                            cur_step[0] = stp; step_t0[0] = time.time()
                        break
                # 工作台词:run.log 新增内容清洗后流出(每轮最多 8 行,防刷屏;单块事件,前端聚合显示)
                try:
                    sz = os.path.getsize(log_path)
                    if sz > log_off[0]:
                        with open(log_path, 'rb') as lf:
                            lf.seek(log_off[0]); chunk = lf.read(min(sz - log_off[0], 65536))
                        log_off[0] += len(chunk)
                        lines = worklog_clean(chunk.decode('utf-8', 'ignore'))
                        if lines:
                            emit(job, {'type': 'worklog', 'lines': lines[-8:]})
                except Exception: pass
                for fn in list_deliverables(job):
                    if fn not in known:
                        known.add(fn); emit(job, {'type': 'artifact', 'name': fn})
            except Exception: pass
    threading.Thread(target=watcher, daemon=True).start()
    rc = -1; spawn_err = ''; spawn_actions = None
    base = os.path.basename(job)
    env = {**agent_env(read_json(conf_path(), {}).get('engine') or {}),
           'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS': '0'}  # 增补 PATH/附加环境变量 + -p 模式等后台任务跑完
    proc = None
    try:
        # 后台跑:stdin 关掉(CLI 不会等交互/弹窗)、新会话(不占当前终端会话,少被 macOS 当前台程序)
        proc = subprocess.Popen(cmd, shell=isinstance(cmd, str), cwd=job, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=log, env=env, **DETACH)
        PROCS[base] = proc
        rc = proc.wait(timeout=3 * 3600)
    except FileNotFoundError:
        miss = os.path.basename(cmd.split()[0] if isinstance(cmd, str) else cmd[0])
        spawn_err = ('没找到「%s」:已自动搜过常见安装位置(Homebrew/npm 等)仍未找到,应该是本机还没装。'
                     '两个解决办法,点下面按钮即可。' % miss)
        spawn_actions = [{'act': 'mock_rerun', 'label': '先用内置演示把流程跑通'},
                         {'act': 'open_engine', 'label': '去绑定已装的生成引擎'}]
    except subprocess.TimeoutExpired:
        kill_tree(proc)
        spawn_err = 'agent 运行超过 3 小时被停止,已生成的交付物保留;可「重跑本任务」续做。'
    except Exception as e: spawn_err = '运行异常:%s' % e
    finally:
        PROCS.pop(base, None)
    if base in CANCEL:                       # 用户删了任务:什么都不用再说
        stop.set(); log.close(); RUNNING.discard(base); CANCEL.discard(base); return
    if spawn_err:
        ev = {'type': 'error', 'text': spawn_err}
        if spawn_actions: ev['actions'] = spawn_actions
        emit(job, ev)
        emit(job, {'type': 'progress', 'stage': '已停止(未能启动生成)', 'pct': 0, 'step': 0, 'total': 12})
    stop.set(); log.close(); RUNNING.discard(base)
    for d in os.listdir(job):
        sub = os.path.join(job, d)
        if os.path.isdir(sub) and d not in ('素材', '章节') and not d.startswith(('.', '_')):
            for fn in os.listdir(sub):
                if fn.endswith(DELIVER_EXT) and not fn.startswith(('_', '.')) and \
                        (fn.startswith('投标') or '自检' in fn or fn.endswith(('.docx', '.xlsx'))):
                    dst = os.path.join(job, fn)
                    if not os.path.exists(dst):
                        try: shutil.move(os.path.join(sub, fn), dst)
                        except Exception: pass
    for fn in list_deliverables(job):
        if fn not in known: known.add(fn); emit(job, {'type': 'artifact', 'name': fn})
    if rc == 0 and known:
        emit(job, {'type': 'progress', 'stage': '完成', 'pct': 100, 'step': 12, 'total': 12})
        summary, actions = artifact_summary(job, known)
        used = skill_evidence(job)
        if not used['ok']:      # 技能包没被读到:产出多半是"自由发挥",必须当面说清而不是假装完成
            summary += ('\n\n⚠ **没有检测到技能包被使用**(%s)。这一版是模型自由发挥的结果,'
                        '通常表现为:结构不全、格式门禁不过、没有响应矩阵与偏离表。'
                        '到「设置 · 生成引擎」把引擎换成内置的 SoWork / Claude Code / Codex(它们会自动带上技能包路径),'
                        '或在自定义命令里加入 {skill} 占位符,然后重跑本任务。' % used['why'])
            actions = (actions or []) + [{'act': 'open_engine', 'label': '去修生成引擎设置'},
                                         {'act': 'open_log', 'label': '查看运行日志'}]
        emit(job, {'type': 'message', 'role': 'agent', 'text': summary, 'actions': actions})
        emit(job, {'type': 'skill_used', 'ok': used['ok'], 'hits': used['hits'], 'why': used['why']})
        try: quality_audit(job, known)
        except Exception as e:
            emit(job, {'type': 'message', 'role': 'agent', 'text': '⚠ 成品质检未能执行:%s' % e})
    elif rc == 0 and not known:
        # 正常退出却一个交付物都没有:以前这里静默,任务永远卡在最后一步
        tail = read_tail(os.path.join(job, 'run.log'), 700)
        emit(job, {'type': 'error',
                   'text': 'agent 跑完了,但**任务目录里没有生成任何交付物**。常见原因:'
                           '① 生成引擎没有文件读写能力(只会聊天,不会写文件);'
                           '② 命令模板里的 {out} 没传对,产物写到别处了;'
                           '③ agent 中途判断信息不足就结束了。请看运行日志确认。',
                   'actions': [{'act': 'open_log', 'label': '查看运行日志'},
                               {'act': 'open_engine', 'label': '换生成引擎'},
                               {'act': 'open_job_folder', 'label': '打开任务文件夹'}]})
        emit(job, {'type': 'progress', 'stage': '已停止(没有产出)', 'pct': 0, 'step': 0, 'total': 12})
    elif rc != 0 and not spawn_err:
        tail = ''
        try: tail = open(os.path.join(job, 'run.log'), encoding='utf-8').read()[-600:]
        except Exception: pass
        low = tail.lower()
        if any(k in low for k in ('usage limit', 'rate limit', 'quota', 'insufficient_quota', 'plan limit',
                                  'exceeded your current', 'too many requests', '429')) or '额度' in tail:
            # 订阅额度耗尽:和「模型接入」的 API Key 是两个钱包,要向用户讲清
            emit(job, {'type': 'error',
                       'text': '生成引擎(claude/codex CLI)的**订阅额度用完了**。说明:生成标书走你的 CLI 订阅额度,'
                               '和「设置 · 模型接入」里的 API Key 是两个独立额度,互不影响。'
                               '等套餐额度窗口重置后点「重跑本任务」即可续做;急用可先换另一个引擎。',
                       'actions': [{'act': 'open_engine', 'label': '去换生成引擎'},
                                   {'act': 'mock_rerun', 'label': '先用内置演示跑通流程'}]})
        else:
            emit(job, {'type': 'error', 'text': 'agent 异常退出(退出码 %s)。可点「重跑本任务」再试;日志尾部:%s' % (rc, tail[-300:].strip() or '(空)')})
        emit(job, {'type': 'progress', 'stage': '已停止(agent 异常退出)', 'pct': 0, 'step': 0, 'total': 12})

# ---------- 生成引擎绑定(claude / codex / 自定义;打包版通过应用内设置,无需环境变量) ----------
AGENT_PROMPT = ('你是标书生成 agent。先完整阅读 {skill}/SKILL.md,然后严格按其流程执行:'
    'tenderPath={tender} outDir={out} materialsDir={materials} skillDir={skill} 。注意:'
    '1) 所有产物直接写入 outDir,不要另建下层输出目录;'
    '2) 招标文件若是 PDF/docx,先转成 招标文件_解析版.md 再分析;'
    '3) 全程同步执行,交付物全部落盘后才允许结束,禁止定时唤醒或把收尾留到以后;{mode}'
    '4) 每完成一个阶段,向 {out}/events.jsonl 追加一行紧凑 JSON:'
    '{"type":"progress","stage":"<阶段名>","pct":<0-100>,"step":<序号>,"total":12};'
    '需要用户决策时追加 {"type":"question","id":"q<n>","text":"<问题>","options":["<选项1>","<选项2>"]} 并继续可并行工作;'
    '5) 最终交付物(投标文件_*.md、*.docx、投标文件自检报告.md)落在 outDir 根目录,出 Word 后必跑 check_docx_format.py 格式门禁;'
    '6) **素材库是唯一事实来源**:开工前先 ls materialsDir 并通读其中的 公司介绍.md / 产品资料.md / 产品能力表.md / '
    '资质与案例.md / 应答要点.md / 图片索引.md 与 章节模板/ 目录;我方身份、产品能力、资质案例一律取自这里,'
    '缺什么写〔需补充〕,严禁编造,也不要另建空素材目录;'
    '7) **必须配图**:若 materialsDir/图片索引.md 存在,撰写时在讲到对应能力/架构/资质处独立成行打标 {{图:图片ID}}'
    '(ID 只能用索引里登记过的,按索引的"落位锚点"插),出 Word 时给 build_tender_docx.py 传 --images-dir "<materialsDir>",'
    '让图片真正插进文档;索引不存在则在正文标注〔配图建议:说明〕;'
    '8) **正文必须是完整段落**:严禁把一句话拆成一行一个字、严禁同一段落反复灌注多次(会被内容门禁判定为废稿);'
    '**每章正文≥3500 字**,每章写完用 wc -m 自查,不达标就地扩写该章再继续;'
    '9) **出 Word 之前必跑质检脚本**:python3 {skill}/references/quality_gate.py <交付稿.md> '
    '--materials {materials} --fix ——它会按图片索引的锚点自动校正图片位置、补插漏图、剔除不存在的图片ID、'
    '折叠重复段落,并产出《成品质检报告.md》;跑完再出 Word。图片ID 只准用图片索引里登记过的,严禁自造。')

# 生成方式:agents=主控编排(SKILL.md 路径B,稳;分析与撰写环节并行提速);workflow=一条流水线并行(快,但更易半路失败)
MODE_AGENTS = ('**必须走 SKILL.md 的【路径 B】:由你作为主控编排子 agent 并亲自验收**,'
    '禁止调用 Workflow 工具跑 multiagent_workflow.js(并行流水线中途失败会整条断掉,产出不稳定)。'
    '**提速纪律(不许串行磨洋工):三个前置分析员必须一次性并行召唤;分章撰写必须并行召唤'
    '(每章一个子 agent 同时派出,平台不支持并行才逐章)——逐章串行是首要的时间浪费**。'
    '每步做完先核对产物文件是否真的写入、用 wc -m 核字数,不达标只重做那一章;'
    '汇总必须用 {skill}/references/assemble_tender.py 脚本拼装(禁止让模型整文重写输出),'
    '配图复核不再单独召唤子 agent——用第 9 条的 quality_gate.py 脚本替代(秒级、零 token);'
    '汇总成册和出 Word 必须由你亲自触发,不要假设子 agent 会自动汇总。')
MODE_WORKFLOW = ('可用 Workflow 工具跑 {skill}/references/multiagent_workflow.js(并行更快,但中途失败易整条中断);'
    '跑完必须逐项核对交付物是否齐全,缺什么就自己补做。')

def skill_dir_conf(conf=None):
    eng = (conf or read_json(conf_path(), {})).get('engine') or {}
    custom = eng.get('skill_dir') or os.environ.get('SKILL_DIR')
    return custom or ensure_skill()   # 托管默认目录必须走 ensure_skill:带版本标记,升级后自动刷新存量目录

SKILL_VERSION = '5.6'   # 技能包内容版本:已解压目录比它旧(或无标记)时,用内置 zip 自动刷新

def ensure_skill():
    """内置技能包:首次运行自动解压到数据目录;版本升级后老目录自动刷新,修复能到存量用户手里"""
    dst = os.path.join(DATA, 'bid-multiagent-tao')
    ver = os.path.join(dst, '.skill_version')
    try: cur = open(ver, encoding='utf-8').read().strip()
    except Exception: cur = ''
    # 版本标记之外再验一个关键文件:曾出过"旧 zip 抢先解压却打上新版本标记"的事故,标记从此不可全信
    if (os.path.isfile(os.path.join(dst, 'SKILL.md')) and cur == SKILL_VERSION
            and os.path.isfile(os.path.join(dst, 'references', 'quality_gate.py'))): return dst
    cands = []
    meipass = getattr(sys, '_MEIPASS', None)           # PyInstaller 打包版:zip 嵌在二进制里
    if meipass: cands.append(os.path.join(meipass, 'bidmultiagenttao_v5.3.zip'))
    cands += [os.path.join(HERE, 'bidmultiagenttao_v5.3.zip'),
              os.path.join(HERE, '..', 'bidmultiagenttao_v5.3.zip')]
    for z in cands:
        if os.path.isfile(z):
            try:
                zipfile.ZipFile(z).extractall(DATA)
                if os.path.isfile(os.path.join(dst, 'SKILL.md')):
                    open(ver, 'w', encoding='utf-8').write(SKILL_VERSION)
                    return dst
            except Exception: pass
    return dst

def _toml_s(v): return json.dumps(str(v), ensure_ascii=False)   # TOML 基本字符串与 JSON 字符串同形,借用转义

def codex_home_s2(eng=None):
    """给 S2 引擎单独造一个 CODEX_HOME:客户机器上原有的 ~/.codex(登录态、订阅额度)一个字都不动。
    每次运行都重写,配置永远和界面上填的一致——省掉「改了设置没生效」这类看不见的坑。"""
    eng = eng or (read_json(conf_path(), {}).get('engine') or {})
    d = _mk(os.path.join(ws_root(), 'codex_s2'))
    up = s2_conf()
    direct = (eng.get('s2_wire') or 'auto') == 'responses' and (eng.get('s2_direct') is True)
    base = up['base_url'] if direct else relay_base()
    toml = '\n'.join([
        '# 中标狗自动生成,请勿手改(每次运行会被覆盖)。作者:' + AUTHOR,
        'model = ' + _toml_s(up['model']),
        'model_provider = "biddog_s2"',
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
        'hide_agent_reasoning = true',
        '',
        '[model_providers.biddog_s2]',
        'name = "中标狗 · S2"',
        'base_url = ' + _toml_s(base),
        'env_key = "BIDDOG_S2_KEY"',
        # 实测 codex-cli 0.146.0:wire_api = "chat" 已被移除,自定义网关只能走 responses,
        # 所以「翻译成 chat/completions」这件事必须由我们这一层做。
        'wire_api = "responses"',
        'request_max_retries = 2',
        'stream_max_retries = 2',
        ''])
    open(os.path.join(d, 'config.toml'), 'w', encoding='utf-8').write(toml)
    return d, base, direct

def opencode_home_s2(eng=None):
    """opencode 的隔离配置:provider 指向本机直通端点,Key 用 {env:} 引用中转口令。
    与用户自己的 opencode(XDG 目录)完全隔离,每次运行重写保持与界面一致。"""
    eng = eng or (read_json(conf_path(), {}).get('engine') or {})
    d = _mk(os.path.join(ws_root(), 'opencode_s2'))
    up = s2_conf()
    direct = (eng.get('s2_wire') or 'auto') == 'responses' and (eng.get('s2_direct') is True)
    base = (up['base_url'] if direct else relay_base())
    conf = {
        '$schema': 'https://opencode.ai/config.json',
        'provider': {'biddog-s2': {
            'npm': '@ai-sdk/openai-compatible', 'name': '中标狗 · S2',
            'options': {'baseURL': base, 'apiKey': '{env:BIDDOG_S2_KEY}'},
            'models': {up['model']: {'name': up['model']}}}},
        # 标书生成要跑脚本/写文件:bash 与 edit 放行;webfetch 关掉(素材是唯一事实来源,不允许上网编)
        'permission': {'edit': 'allow', 'bash': 'allow', 'webfetch': 'deny'},
    }
    write_json(os.path.join(d, 'opencode.json'), conf)
    return d, base, direct

def opencode_env(eng):
    d, _base, direct = opencode_home_s2(eng)
    up = s2_conf()
    home = _mk(os.path.join(d, 'home'))
    no = ','.join(x for x in ['127.0.0.1', 'localhost', os.environ.get('NO_PROXY', ''), os.environ.get('no_proxy', '')] if x)
    return {'OPENCODE_CONFIG': os.path.join(d, 'opencode.json'),
            'BIDDOG_S2_KEY': (up['api_key'] if direct else relay_token()),
            'XDG_DATA_HOME': os.path.join(home, 'data'), 'XDG_CONFIG_HOME': os.path.join(home, 'cfg'),
            'XDG_CACHE_HOME': os.path.join(home, 'cache'),
            'NO_PROXY': no, 'no_proxy': no}

def s2_env(eng):
    """S2 引擎专用环境:指向我们自己的 CODEX_HOME;直连时给真 Key,走中转时只给本机中转口令(真 Key 不出引擎进程)"""
    d, _base, direct = codex_home_s2(eng)
    up = s2_conf()
    no = ','.join(x for x in ['127.0.0.1', 'localhost', os.environ.get('NO_PROXY', ''), os.environ.get('no_proxy', '')] if x)
    return {'CODEX_HOME': d, 'BIDDOG_S2_KEY': (up['api_key'] if direct else relay_token()),
            'NO_PROXY': no, 'no_proxy': no}   # 公司网络的代理变量会把「连本机中转」也代理掉,必须排除回环

def config_agent_cmd():
    """真实 agent 命令:env AGENT_CMD 最优先(字符串,shell 执行);否则按应用内设置生成(列表,免引号跨平台)"""
    env = os.environ.get('AGENT_CMD', '')
    if env: return env
    conf = read_json(conf_path(), {})
    eng = conf.get('engine') or {}
    kind = eng.get('kind', 's2')      # 默认「自动」:没 Key 时下一行会回落演示
    if kind == 'custom': return eng.get('cmd', '')
    # 「自动」的语义:有 Key 才产真实标书,没 Key 就返回空 → 上层自动回落内置演示流程(不报错、不空跑)
    if kind in ('s2', 'opencode') and not s2_conf(conf)['api_key']: return ''
    if kind not in ('claude', 'codex', 'sowork', 's2', 'opencode'): return ''
    sd = skill_dir_conf(conf)
    if not os.path.isfile(os.path.join(sd, 'SKILL.md')): sd = ensure_skill()
    mode = MODE_WORKFLOW if eng.get('mode') == 'workflow' else MODE_AGENTS   # 默认稳健的多子 agent
    prompt = AGENT_PROMPT.replace('{mode}', mode).replace('{skill}', sd)
    if kind == 'claude':
        sf = os.path.join(DATA, 'agent_settings.json')
        if not os.path.isfile(sf):
            write_json(sf, {'permissions': {'allow': ['Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)', 'MultiEdit(*)',
                'Glob(*)', 'Grep(*)', 'Task(*)', 'TodoWrite', 'LS(*)', 'WebFetch(*)', 'Workflow(*)', 'ToolSearch(*)', 'Skill(*)', 'NotebookEdit(*)']}})
        return [resolve_cli('claude', eng) or 'claude', '-p', prompt, '--settings', sf]
    if kind == 'sowork':
        # SoWork(商汤)自带 openclaw CLI:用本机已登录账号与网关,不另配 Key。
        # --thinking off:SenseAudio-S2 目前只支持 off,填 medium/high 会直接报错退出。
        # --session-key 带任务号:多任务/多人并行时会话不串。
        return [resolve_cli('sowork', eng) or 'openclaw', 'agent',
                '--agent', (eng.get('sowork_agent') or 'main'),
                '--session-key', 'bid-dog-{jobid}',
                '--thinking', (eng.get('thinking') or 'off'),
                '--timeout', str(int(eng.get('timeout') or 1800)),
                '--message', prompt]
    if kind == 'opencode':
        # opencode 原生 OpenAI 兼容:baseURL 指本机直通端点即可,零协议翻译。--auto=非交互放行
        up = s2_conf(conf)
        # --dir {out}:把 opencode 的工作目录钉死在任务目录(它默认会向上找"项目根",可能钉错层)
        return [resolve_cli('opencode', eng) or 'opencode', 'run', '--auto', '--dir', '{out}',
                '-m', 'biddog-s2/' + up['model'], prompt]
    # --skip-git-repo-check:任务目录不是 git 仓库也能跑
    # --dangerously-bypass-approvals-and-sandbox:非交互执行,免"信任目录/审批"卡住(本机自有目录)
    # s2 与 codex 共用同一个 CLI,区别只在环境变量(CODEX_HOME 指向我们生成的配置),见 s2_env
    return [resolve_cli('codex', eng) or 'codex', 'exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', prompt]

@app.get('/v1/agent')
def agent_status():
    conf = read_json(conf_path(), {})
    eng = conf.get('engine') or {}
    sd = skill_dir_conf(conf)
    if not os.path.isfile(os.path.join(sd, 'SKILL.md')): sd = ensure_skill()
    cl, cx, sw, oc = resolve_cli('claude', eng), resolve_cli('codex', eng), resolve_cli('sowork', eng), resolve_cli('opencode', eng)
    return {'kind': 'env' if os.environ.get('AGENT_CMD') else eng.get('kind', 's2'), 'mode': eng.get('mode', 'agents'),
            'cmd': eng.get('cmd', ''), 'skill_dir': sd, 'skill_ok': os.path.isfile(os.path.join(sd, 'SKILL.md')),
            'available': {'claude': bool(cl), 'codex': bool(cx), 'sowork': bool(sw), 'opencode': bool(oc)},
            'paths': {'claude': cl or '', 'codex': cx or '', 'sowork': sw or '', 'opencode': oc or ''},
            'cli_path': eng.get('cli_path', ''), 'env': eng.get('env', ''),
            'login_shell': eng.get('login_shell', True), 'sowork_agent': eng.get('sowork_agent', 'main'),
            'thinking': eng.get('thinking', 'off'), 'timeout': eng.get('timeout', 1800),
            's2_base_url': eng.get('s2_base_url', ''), 's2_model': eng.get('s2_model', ''),
            's2_key_set': bool((eng.get('s2_key') or '').strip()),   # 只回是否已填,不把 Key 回传给页面
            's2_wire': eng.get('s2_wire', 'auto'), 's2_verify_ssl': eng.get('s2_verify_ssl', True),
            's2_defaults': {'base_url': S2_DEFAULT_BASE, 'model': S2_DEFAULT_MODEL},
            's2_borrowed': (not (eng.get('s2_key') or '').strip()) and bool(s2_conf(conf)['api_key']),
            'codex_bundled': bool(bundled_codex()), 'opencode_bundled': bool(bundled_cli('opencode-cli')),
            's2_model_effective': s2_conf(conf)['model']}

@app.put('/v1/agent')
async def set_agent(req: Request):
    # 云端网页模式默认禁止:网页端可改命令 = 给访客开服务器远程执行
    if MULTIUSER and not ALLOW_AGENT_CONFIG:
        return JSONResponse({'ok': False, 'error': '云端部署已锁定生成引擎设置(由部署方通过环境变量配置)'}, 403)
    body = await req.json()
    conf = read_json(conf_path(), {'providers': [], 'routing': {}})
    old = conf.get('engine') or {}
    conf['engine'] = {'kind': body.get('kind', 'mock'), 'cmd': body.get('cmd', ''),
                      'skill_dir': body.get('skill_dir', ''), 'mode': body.get('mode', 'agents'),
                      'cli_path': body.get('cli_path', ''), 'env': body.get('env', ''),
                      'login_shell': body.get('login_shell', True),
                      'sowork_agent': body.get('sowork_agent', 'main'),
                      'thinking': body.get('thinking', 'off'),
                      'timeout': body.get('timeout', 1800),
                      's2_base_url': body.get('s2_base_url', ''), 's2_model': body.get('s2_model', ''),
                      # Key 留空 = 沿用已存的(页面不回显 Key,不能因为"没传"就把它清掉)
                      's2_key': (body.get('s2_key') or '').strip() or old.get('s2_key', ''),
                      's2_wire': body.get('s2_wire', 'auto'), 's2_verify_ssl': body.get('s2_verify_ssl', True)}
    if body.get('s2_key_clear'): conf['engine']['s2_key'] = ''
    write_json(conf_path(), conf)
    return {'ok': True}

@app.post('/v1/agent/test')
def agent_test():
    """一键连通性测试:用当前绑定的引擎发一条最小指令,把结果翻译成人话。
    客户不用开终端——这是「终端能跑、App 里不行」类问题的自助排查入口。"""
    conf = read_json(conf_path(), {})
    eng = conf.get('engine') or {}
    kind = 'env' if os.environ.get('AGENT_CMD') else eng.get('kind', 's2')
    if kind == 'mock':
        return {'ok': True, 'note': '当前是内置演示流程,无需外部 CLI(要产真实标书请选一个生成引擎)'}
    probe = '只回复六个字:中标狗连接成功'
    if kind == 'sowork':
        cli = resolve_cli('sowork', eng)
        if not cli: return {'ok': False, 'error': '没找到 SoWork 的 openclaw 命令。请确认已安装并登录 SoWork;'
                                                 '若装在非默认位置,把完整路径填到下面的「CLI 路径」。'}
        cmd = [cli, 'agent', '--agent', eng.get('sowork_agent') or 'main',
               '--session-key', 'bid-dog-selftest', '--thinking', eng.get('thinking') or 'off',
               '--timeout', '60', '--message', probe]
    elif kind == 'claude':
        cli = resolve_cli('claude', eng)
        if not cli: return {'ok': False, 'error': '没找到 claude 命令,请先安装 Claude Code CLI 并登录'}
        cmd = [cli, '-p', probe]
    elif kind == 'codex':
        cli = resolve_cli('codex', eng)
        if not cli: return {'ok': False, 'error': '没找到 codex 命令,请先安装 Codex CLI 并登录'}
        cmd = [cli, 'exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', probe]
    elif kind == 'opencode':
        up = s2_conf(conf)
        if not up['api_key']:
            return {'ok': False, 'error': '还没填 S2 API Key(和「S2 模型」引擎共用同一串 Key)。'}
        try:
            _openai_req(up['base_url'], up['api_key'], '/models', timeout=20, verify=up['verify_ssl'])
        except urllib.error.HTTPError as e:
            msg = {401: 'Key 不对或已停用', 403: 'Key 没有权限', 429: '额度/频率超限'}.get(e.code, 'HTTP %s' % e.code)
            return {'ok': False, 'error': '连不上 S2 网关:%s。地址:%s' % (msg, up['base_url'])}
        except Exception as e:
            return {'ok': False, 'error': '连不上 S2 网关:%s' % net_hint(e)}
        cli = resolve_cli('opencode', eng)
        if not cli:
            return {'ok': False, 'need_provision': True,
                    'error': 'S2 网关是通的,只差 OpenCode 外壳。点「一键安装执行外壳」(约 80MB);'
                             '或手动:npm i -g opencode-ai。装完都不用登录。'}
        cmd = [cli, 'run', '--auto', '-m', 'biddog-s2/' + up['model'], probe]
    elif kind == 's2':
        # 三层分开验:①Key/网关能不能通 ②Codex CLI 在不在 ③整条链路(Codex→中转→S2)能不能跑通。
        # 分层报错是为了让客户自己看得懂卡在哪一层,而不是只看到一句"异常退出"。
        up = s2_conf(conf)
        if not up['api_key']:
            return {'ok': False, 'error': '还没填 API Key——现在新建任务会跑内置演示流程(样例稿)。'
                                          '把你收到的那串 Key(sk-…)填进来即产真实标书;'
                                          '或先在「模型接入」里加好接入点,这里会自动借用。'}
        try:
            data = _openai_req(up['base_url'], up['api_key'], '/models', timeout=20, verify=up['verify_ssl'])
            ids = [m.get('id') for m in (data.get('data') or []) if m.get('id')]
            if ids and up['model'] not in ids:
                return {'ok': False, 'error': '网关通了,但你的套餐里没有模型「%s」。可用的是:%s' % (up['model'], '、'.join(ids[:8]))}
        except urllib.error.HTTPError as e:
            code = e.code
            msg = {401: 'Key 不对或已停用', 403: 'Key 没有这个网关的权限', 429: 'Key 的额度/频率超限'}.get(code, 'HTTP %s' % code)
            return {'ok': False, 'error': '连不上 S2 网关:%s。地址:%s' % (msg, up['base_url'])}
        except Exception as e:
            return {'ok': False, 'error': '连不上 S2 网关:%s' % net_hint(e)}
        cli = resolve_cli('codex', eng)
        if not cli:
            return {'ok': False, 'need_provision': True,
                    'error': 'S2 网关本身是通的,只差执行外壳。点下面的「一键安装执行外壳」即可(约 130MB,不需要登录、不消耗任何订阅额度);或手动 npm i -g @openai/codex。'}
        cmd = [cli, 'exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', probe]
    else:   # custom / env:把命令里的占位符换成临时目录,只验证能否跑起来
        raw = os.environ.get('AGENT_CMD') or eng.get('cmd', '')
        if not raw: return {'ok': False, 'error': '还没填自定义命令'}
        tmp = _mk(os.path.join(DATA, '_selftest'))
        rep = lambda s: (s.replace('{tender}', os.path.join(tmp, 'probe.md')).replace('{out}', tmp)
                          .replace('{materials}', assets_dir()).replace('{jobid}', 'selftest'))
        open(os.path.join(tmp, 'probe.md'), 'w', encoding='utf-8').write('# 连通性测试\n')
        cmd = rep(raw) if isinstance(raw, str) else [rep(a) for a in raw]
    cmd = login_shell_wrap(cmd, eng)
    t0 = time.time()
    try:
        r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, timeout=int(eng.get('test_timeout') or 120),
                           env=agent_env(eng), cwd=DATA, **DETACH)
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': '测试超时(超过 2 分钟没有返回)。多为网关不通或 CLI 在等待登录/授权。'}
    except FileNotFoundError as e:
        return {'ok': False, 'error': '命令启动失败:%s。检查 CLI 路径是否正确。' % e}
    except Exception as e:
        return {'ok': False, 'error': '测试失败:%s' % e}
    out = ((r.stdout or '') + '\n' + (r.stderr or '')).strip()
    ms = int((time.time() - t0) * 1000)
    if r.returncode == 0:
        return {'ok': True, 'latency_ms': ms, 'reply': out[-300:] or '(无输出)'}
    low = out.lower()
    hint = ''
    if 'thinking' in low and ('not supported' in low or 'unsupported' in low):
        hint = '该模型不支持所选思考等级,请把「思考等级」改成 off。'
    elif any(k in low for k in ('connection refused', 'gateway', 'econnrefused', 'timed out', 'tls', 'certificate')):
        hint = ('连不上本机网关。App 是双击启动的,拿不到你终端里的环境变量——'
                '请保持「用登录 shell 启动」勾选;仍不行就在「附加环境变量」里指定网关地址/配置路径。')
    elif any(k in low for k in ('unauthorized', 'not logged in', 'login', '401')):
        hint = '未登录或授权失效,请先在对应 App/CLI 里登录后重试。'
    elif any(k in low for k in ('usage limit', 'quota', 'rate limit', '429')):
        hint = '该 CLI 的订阅额度用完了(与「模型接入」的 API Key 是两个独立额度)。'
    elif 'openclaw doctor' in low or ('mismatch' in low and 'config uses' in low):
        hint = ('这是 SoWork 本机安装自身的配置问题(插件配置不一致),与中标狗无关:'
                '终端跑一次 openclaw doctor 按提示修复,或重启/重装 SoWork;'
                '急用的话先把生成引擎切成「S2 模型」(不依赖 SoWork)。')
    if kind == 's2' and RELAY_LAST.get('error'):
        hint = '中转层报告:%s' % RELAY_LAST['error']      # 真实原因往往在上游,别让客户只看到 codex 的退出码
    return {'ok': False, 'error': ('退出码 %s。%s' % (r.returncode, hint)).strip(), 'reply': out[-300:]}

@app.post('/v1/jobs')
async def create_job(tender: UploadFile = File(None), materials: UploadFile = File(None),
                     files: List[UploadFile] = File(None), relpaths: str = Form(''),
                     prompt: str = Form(''), name: str = Form(''), mock: str = Form('auto'),
                     start: str = Form('1')):
    """建任务(向导版约定):
    - tender = 招标文件(主件,永远落任务根目录——绝不进 素材/,素材库污染是内容变薄的根源之一)
    - files + relpaths = 参考素材(多文件/整文件夹,保留目录结构,落 素材/;相对路径做穿越防护)
    - start='0' 只暂存(任务状态=待开始),等 /v1/jobs/{jid}/start 再跑
    兼容旧调用:只传 tender(+materials zip)行为不变。"""
    fl = [f for f in (files or []) if f and f.filename]
    if not (tender and tender.filename) and not fl:
        return JSONResponse({'error': '至少要有一个文件(招标文件)'}, 400)
    try: rels = json.loads(relpaths or '[]')
    except Exception: rels = []
    rels = [str(r or '') for r in rels] if isinstance(rels, list) else []
    while len(rels) < len(fl): rels.append('')
    doc_like = lambda fn: not fn.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.zip'))
    if not (tender and tender.filename) and fl:
        # 前端没显式指定主件时,从 files 里挑:优先文件名像招标文件的文档,其次任意文档;挑走后从素材里移除
        pick = next((i for i, f in enumerate(fl)
                     if re.search(r'招标|采购|磋商|询价|tender|rfp', os.path.basename(f.filename), re.I)
                     and doc_like(f.filename)), None)
        if pick is None: pick = next((i for i, f in enumerate(fl) if doc_like(f.filename)), 0)
        tender = fl.pop(pick); rels.pop(pick)
    jid = datetime.datetime.now().strftime('%m%d-%H%M%S-') + uuid.uuid4().hex[:4]
    job = jpath(jid); os.makedirs(job)
    tname = os.path.basename(tender.filename or '招标文件.pdf')
    open(os.path.join(job, tname), 'wb').write(await tender.read())
    mdir = os.path.join(job, '素材')          # 注意:没有素材就不建目录,空 素材/ 会顶掉全局素材库的回落
    for i, f in enumerate(fl):
        rel = (rels[i] or f.filename or 'file').replace('\\', '/')
        rel = os.path.normpath(rel).replace(os.sep, '/')
        if rel.startswith(('..', '/')) or os.path.isabs(rel): rel = os.path.basename(f.filename or '') or 'file'
        while rel.startswith('./'): rel = rel[2:]
        parts = [x for x in rel.split('/') if x not in ('', '.', '..')]
        # 只剥一层:显式的 素材/ 前缀剥掉后其余层级原样保留;否则视为"拖入的文件夹名"剥掉顶层。
        # (曾经两条规则叠加把 素材/图片/x.png 剥成 x.png,图片索引全部失配——图不见了就是这来的)
        if parts and parts[0] == '素材': parts = parts[1:]
        elif len(parts) > 1: parts = parts[1:]
        rel = '/'.join(parts)
        dest = os.path.join(mdir, rel or os.path.basename(f.filename or 'file'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, 'wb').write(await f.read())
    if materials and materials.filename:
        z = os.path.join(job, '_m.zip'); open(z, 'wb').write(await materials.read())
        try: zipfile.ZipFile(z).extractall(_mk(mdir))
        except Exception: pass
    write_json(os.path.join(job, '任务.json'), {'name': name or tname, 'created_at': now(),
               'paused': False, 'staged': start == '0', 'tender': tname})
    if prompt: emit(job, {'type': 'message', 'role': 'user', 'text': prompt})
    if start == '0':
        emit(job, {'type': 'progress', 'stage': '待开始(素材已就位,点「开始生成」)', 'pct': 0, 'step': 0, 'total': 12})
        return {'job_id': jid, 'mode': 'staged'}
    return _launch_job(jid, job, mock)

def _launch_job(jid, job, mock='auto'):
    """按当前引擎配置启动生成。主件路径只信 任务.json 的 tender 字段(建任务时就定死,不做猜测)。"""
    meta = read_json(os.path.join(job, '任务.json'), {})
    tpath = os.path.join(job, os.path.basename(meta.get('tender') or ''))
    if not os.path.isfile(tpath):
        emit(job, {'type': 'error', 'text': '找不到招标文件「%s」,请删除本任务重新创建。' % meta.get('tender')})
        return {'job_id': jid, 'mode': 'error'}
    agent_cmd = config_agent_cmd()
    use_mock = (mock == '1') or (mock == 'auto' and not agent_cmd)
    if use_mock:
        conf0 = read_json(conf_path(), {})
        if (conf0.get('engine') or {}).get('kind', 's2') in ('s2', 'opencode') and not s2_conf(conf0)['api_key']:
            emit(job, {'type': 'message', 'role': 'agent',
                       'text': '当前还没填 API Key,先用**内置演示流程**把全流程跑给你看(产出为样例稿)。'
                               '到「设置 · 模型接入」把 Key 填上再重跑本任务,产出的就是真实标书。',
                       'actions': [{'act': 'open_engine', 'label': '去填 Key'}]})
        threading.Thread(target=mock_agent, args=(job,), daemon=True).start()
    else:
        mdir = os.path.join(job, '素材')
        mat = mdir if os.path.isdir(mdir) else assets_dir()
        sd_path = skill_dir_conf(read_json(conf_path(), {}))
        if not os.path.isfile(os.path.join(sd_path, 'SKILL.md')): sd_path = ensure_skill()
        sub = lambda x: (x.replace('{tender}', tpath).replace('{out}', job)
                          .replace('{materials}', mat).replace('{jobid}', jid).replace('{skill}', sd_path))
        cmd = [sub(a) for a in agent_cmd] if isinstance(agent_cmd, list) else sub(agent_cmd)
        cmd = login_shell_wrap(cmd, (read_json(conf_path(), {}).get('engine') or {}))
        threading.Thread(target=real_agent, args=(job, cmd), daemon=True).start()
    return {'job_id': jid, 'mode': 'mock' if use_mock else 'agent'}

@app.post('/v1/jobs/{jid}/start')
def start_job(jid: str, mock: str = 'auto'):
    """启动「待开始」的暂存任务(向导里点「稍后开始」建出来的)"""
    job = jpath(jid)
    if not os.path.isdir(job): return JSONResponse({'ok': False, 'error': '任务不存在'}, 404)
    meta = read_json(os.path.join(job, '任务.json'), {})
    base = os.path.basename(jid)
    if not meta.get('staged') and (base in RUNNING):
        return {'ok': True, 'note': '任务已在运行'}
    meta['staged'] = False
    write_json(os.path.join(job, '任务.json'), meta)
    r = _launch_job(jid, job, mock)
    return {'ok': r.get('mode') != 'error', **r}

@app.delete('/v1/jobs/{jid}')
def del_job(jid: str):
    job = jpath(jid)                      # jpath 已做 basename,防目录穿越
    if not os.path.isdir(job): return {'ok': True}   # 已经没了=删除成功,幂等
    base = os.path.basename(jid)
    CANCEL.add(base)                      # 通知 mock 线程收工
    kill_tree(PROCS.pop(base, None))      # 真实 agent 还在跑:连子孙进程一起收掉
    for _ in range(3):                    # 进程退出与文件句柄释放有竞态,小重试
        shutil.rmtree(job, ignore_errors=True)
        if not os.path.isdir(job): break
        time.sleep(0.4)
    RUNNING.discard(base)
    return {'ok': True}

@app.get('/v1/jobs')
def list_jobs():
    out = []
    for jid in sorted(os.listdir(jobs_dir()), reverse=True):
        job = jpath(jid)
        if not os.path.isdir(job): continue
        meta = read_json(os.path.join(job, '任务.json'), {})
        prog = read_json(os.path.join(job, 'progress.json'), {})
        out.append({'job_id': jid, 'name': meta.get('name', jid), 'created_at': meta.get('created_at', ''),
                    'stage': prog.get('stage', '启动中'), 'pct': prog.get('pct', 0),
                    'staged': bool(meta.get('staged'))})
    return out

@app.get('/v1/jobs/{jid}/events')
def events(jid: str, offset: int = 0):
    """SSE:从 offset 行起回放并持续跟踪 events.jsonl;
       真实 agent 自己写的事件行没有 ts,这里首次读到时补一个并持久化,
       否则每次重连/切换任务都会被当成"刚刚发生",耗时与预估全部归零。"""
    job = jpath(jid)
    path = os.path.join(job, 'events.jsonl')
    tsf = os.path.join(job, '.line_ts.json')
    def stamp(idx, line, index):
        try: e = json.loads(line)
        except Exception: return line
        if e.get('ts'): return line
        key = str(idx)
        if key not in index:
            index[key] = now()
            try: write_json(tsf, index)
            except Exception: pass
        e['ts'] = index[key]
        return json.dumps(e, ensure_ascii=False)
    async def gen():
        # async 生成器:网页端每个连接不再占死一条线程池线程(多标签页/多次重连曾把线程池耗干,
        # 表现为"页面转半天然后断开、agent 请求全部卡住")。空转时 10 秒一个心跳防反代掐线。
        sent, idle = 0, 0
        index = read_json(tsf, {})
        for _ in range(3600 * 8):
            burst = False
            if os.path.isfile(path):
                try: lines = open(path, encoding='utf-8').read().splitlines()
                except Exception: lines = []
                while sent < len(lines):
                    if sent >= offset: yield 'data: %s\n\n' % stamp(sent, lines[sent], index)
                    sent += 1; burst = True
            idle = 0 if burst else idle + 1
            if idle and idle % 10 == 0: yield ': ping\n\n'
            await asyncio.sleep(1)
    return StreamingResponse(gen(), media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

def job_context(job, limit=9000):
    """把任务的关键产出摘要拼成上下文,供任务结束后的问答使用"""
    ctx, budget = [], limit
    meta = read_json(os.path.join(job, '任务.json'), {})
    ctx.append('任务:%s(招标文件:%s)' % (meta.get('name', ''), meta.get('tender', '')))
    prog = read_json(os.path.join(job, 'progress.json'), {})
    if prog: ctx.append('进度:%s %s%%' % (prog.get('stage', ''), prog.get('pct', 0)))
    ctx.append('已产出:%s' % '、'.join(list_deliverables(job)) or '(无)')
    # 用户上传的参考资料优先进上下文(他多半就是想问这个)
    rd = os.path.join(job, '参考资料')
    if os.path.isdir(rd):
        for fn in sorted(os.listdir(rd))[:3]:
            if budget <= 0: break
            fp = os.path.join(rd, fn)
            try:
                import doc_quality as dq
                txt = dq.read_any(fp) if fn.lower().endswith(('.docx', '.md', '.txt')) else ''
            except Exception:
                txt = ''
            if txt:
                take = txt[:min(3000, budget)]
                ctx.append('--- 参考资料:%s ---\n%s' % (fn, take)); budget -= len(take)
    # 优先喂自检报告与关键分析件,再补正文
    order = ['自检', '响应矩阵', '废标', '评分', '偏离', '组成', '格式要求', '投标文件_']
    files = sorted(list_deliverables(job), key=lambda f: next((i for i, k in enumerate(order) if k in f), 99))
    for fn in files:
        if not fn.endswith('.md') or budget <= 0: continue
        try: txt = open(os.path.join(job, fn), encoding='utf-8', errors='ignore').read()
        except Exception: continue
        take = txt[:min(2500, budget)]
        ctx.append('--- %s ---\n%s' % (fn, take)); budget -= len(take)
    return '\n'.join(ctx)

def chat_reply(job, jid, question):
    """任务结束后的追问:用已配模型 + 任务产出上下文回答。无论成败最后都发 status idle,前端"正在回复"不悬空"""
    try:
        conf = read_json(conf_path(), {'providers': [], 'routing': {}})
        ps = conf.get('providers') or []
        p = next((x for x in ps if x.get('id') == (conf.get('routing') or {}).get('default')), ps[-1] if ps else None)
        if not p or not p.get('model'):
            emit(job, {'type': 'message', 'role': 'agent',
                       'text': '这条已记下。当前任务的 agent 已结束;要我基于已生成的内容直接回答,请先在「设置 · 模型接入」里配好模型。'})
            return
        hist = []
        try:
            for ln in open(os.path.join(job, 'events.jsonl'), encoding='utf-8').read().splitlines()[-40:]:
                e = json.loads(ln)
                if e.get('type') == 'message' and e.get('text') and e.get('role') in ('user', 'agent'):
                    hist.append({'role': 'user' if e.get('role') == 'user' else 'assistant', 'text': e['text'][:600]})
        except Exception: pass
        msgs = [{'role': 'system', 'content': '你是中标狗。基于下面这份任务的实际产出回答用户提问,'
                 '只依据材料、不编造;涉及投标人名称/报价/资质等未填项要如实说明需人工补充。\n\n' + job_context(job)}]
        msgs += [{'role': m['role'], 'content': m['text']} for m in hist[-8:]]
        msgs.append({'role': 'user', 'content': question})
        try:
            resp = _openai_req(p.get('base_url'), p.get('api_key'), '/chat/completions',
                               {'model': p['model'], 'messages': msgs, 'max_tokens': 900},
                               timeout=60, verify=p.get('verify_ssl', True))
            txt = ((resp.get('choices') or [{}])[0].get('message') or {}).get('content', '') or '(模型无回复)'
        except Exception as e:
            txt = '回答失败:%s' % net_hint(e)
        emit(job, {'type': 'message', 'role': 'agent', 'text': txt})
    finally:
        emit(job, {'type': 'status', 'state': 'idle'})

@app.post('/v1/jobs/{jid}/attachments')
async def add_attachment(jid: str, file: UploadFile = File(...)):
    """给当前任务加参考资料(如过往标书),agent 与追问都会读到它"""
    job = jpath(jid)
    if not os.path.isdir(job): return JSONResponse({'ok': False, 'error': 'not found'}, 404)
    d = os.path.join(job, '参考资料'); os.makedirs(d, exist_ok=True)
    fn = os.path.basename(file.filename or '参考资料')
    open(os.path.join(d, fn), 'wb').write(await file.read())
    emit(job, {'type': 'message', 'role': 'user', 'text': '（已上传参考资料:%s）' % fn})
    note = {'type': 'reference', 'file': '参考资料/' + fn,
            'hint': '这是用户提供的参考资料,撰写时可参考其写法与口径,但事实数据仍以素材库为准'}
    open(os.path.join(job, 'inbox.jsonl'), 'a', encoding='utf-8').write(json.dumps(note, ensure_ascii=False) + '\n')
    running = os.path.basename(jid) in RUNNING
    emit(job, {'type': 'message', 'role': 'agent',
               'text': ('已收到参考资料「%s」,会在后续章节里参考它的写法。' % fn) if running
                       else ('已收到参考资料「%s」,已存入任务的「参考资料」目录;现在可以直接问我关于它的问题。' % fn)})
    return {'ok': True, 'name': fn}

@app.get('/v1/jobs/{jid}/attachments')
def list_attachments(jid: str):
    d = os.path.join(jpath(jid), '参考资料')
    if not os.path.isdir(d): return []
    return [{'name': fn, 'size_kb': round(os.path.getsize(os.path.join(d, fn)) / 1024, 1)}
            for fn in sorted(os.listdir(d)) if not fn.startswith('.')]

@app.post('/v1/jobs/{jid}/rerun')
async def rerun_job(jid: str):
    """用同一份招标文件重开一个任务(素材库补好后重跑,不用再找原文件)"""
    old = jpath(jid)
    meta = read_json(os.path.join(old, '任务.json'), {})
    tname = meta.get('tender', '')
    tpath = os.path.join(old, tname)
    if not (tname and os.path.isfile(tpath)):
        return JSONResponse({'ok': False, 'error': '原任务的招标文件不在了'}, 404)
    nid = datetime.datetime.now().strftime('%m%d-%H%M%S-') + uuid.uuid4().hex[:4]
    nj = jpath(nid); os.makedirs(nj)
    shutil.copy2(tpath, os.path.join(nj, tname))
    ref = os.path.join(old, '参考资料')
    if os.path.isdir(ref): shutil.copytree(ref, os.path.join(nj, '参考资料'))
    write_json(os.path.join(nj, '任务.json'),
               {'name': (meta.get('name', '') or tname) + ' · 重跑', 'created_at': now(), 'paused': False, 'tender': tname})
    agent_cmd = config_agent_cmd()
    use_mock = not agent_cmd
    if use_mock:
        threading.Thread(target=mock_agent, args=(nj,), daemon=True).start()
    else:
        mat = assets_dir()
        sd_path = skill_dir_conf(read_json(conf_path(), {}))
        if not os.path.isfile(os.path.join(sd_path, 'SKILL.md')): sd_path = ensure_skill()
        sub = lambda s: (s.replace('{tender}', os.path.join(nj, tname)).replace('{out}', nj)
                          .replace('{materials}', mat).replace('{jobid}', nid).replace('{skill}', sd_path))
        cmd = [sub(a) for a in agent_cmd] if isinstance(agent_cmd, list) else sub(agent_cmd)
        cmd = login_shell_wrap(cmd, (read_json(conf_path(), {}).get('engine') or {}))
        threading.Thread(target=real_agent, args=(nj, cmd), daemon=True).start()
    return {'ok': True, 'job_id': nid, 'mode': 'mock' if use_mock else 'agent'}

def mock_redo(job, instruction):
    """演示引擎的定向重做:三步小流程,产出重做说明,进度回到完成态"""
    RUNNING.add(os.path.basename(job))
    try:
        steps = ['定位相关内容', '按指令重写', '重新汇总自检']
        for i, st in enumerate(steps):
            if _cancelled(job): return
            emit(job, {'type': 'progress', 'stage': '定向重做:' + st, 'pct': int((i + 0.5) / 3 * 100), 'step': i + 1, 'total': 3})
            time.sleep(1.2)
        fn = '定向重做说明.md'
        open(os.path.join(job, fn), 'w', encoding='utf-8').write(
            '# 定向重做说明\n\n指令:%s\n\n(演示引擎:真实引擎会按指令改写对应产物并更新自检报告)\n' % instruction)
        emit(job, {'type': 'artifact', 'name': fn})
        emit(job, {'type': 'progress', 'stage': '完成', 'pct': 100, 'step': 3, 'total': 3})
        emit(job, {'type': 'message', 'role': 'agent', 'text': '定向重做完成:「%s」。已更新产物并重新自检。' % instruction[:60]})
    finally:
        RUNNING.discard(os.path.basename(job)); CANCEL.discard(os.path.basename(job))

@app.get('/v1/jobs/{jid}/log')
def job_log(jid: str, n: int = 20000):
    """agent 原始运行日志:判断「到底有没有用到技能包/为什么没产出」的唯一硬证据"""
    job = jpath(jid)
    txt = read_tail(os.path.join(job, 'run.log'), max(1000, min(int(n or 20000), 200000)))
    ev = skill_evidence(job)
    return {'ok': True, 'log': txt or '(没有运行日志:该任务用的是内置演示流程,或 agent 没有任何输出)',
            'skill_used': ev['ok'], 'hits': ev['hits'], 'why': ev['why']}

@app.post('/v1/jobs/{jid}/stop')
def stop_job(jid: str):
    """停止正在跑的任务(保留已生成的产物,不删任务)"""
    base = os.path.basename(jid); job = jpath(jid)
    if not os.path.isdir(job): return JSONResponse({'ok': False, 'error': 'not found'}, 404)
    if base not in RUNNING: return {'ok': True, 'note': '任务本来就没有在运行'}
    CANCEL.add(base)          # 由 real_agent 收尾时清除;提前清会让"手动停止"被误报成"异常退出"
    kill_tree(PROCS.pop(base, None))
    RUNNING.discard(base)
    emit(job, {'type': 'message', 'role': 'agent', 'text': '已按你的要求停止。已生成的产物都保留着,可以「重跑」或「定向重做」。'})
    emit(job, {'type': 'progress', 'stage': '已停止(手动)', 'pct': 0, 'step': 0, 'total': 12})
    return {'ok': True}

@app.post('/v1/jobs/{jid}/redo')
async def redo_job(jid: str, req: Request):
    """定向重做:在当前任务里只重做用户指定的部分,其余产物保留,完成后重新汇总自检"""
    body = await req.json()
    instruction = (body.get('instruction') or '').strip()
    job = jpath(jid)
    if not os.path.isdir(job): return JSONResponse({'ok': False, 'error': 'not found'}, 404)
    if not instruction: return JSONResponse({'ok': False, 'error': '缺少重做指令'}, 400)
    if os.path.basename(jid) in RUNNING:
        return JSONResponse({'ok': False, 'error': '任务正在运行,等它停下或先暂停再定向重做'}, 409)
    agent_cmd = config_agent_cmd()
    if not agent_cmd:
        threading.Thread(target=mock_redo, args=(job, instruction), daemon=True).start()
        return {'ok': True, 'mode': 'mock'}
    conf = read_json(conf_path(), {})
    meta = read_json(os.path.join(job, '任务.json'), {})
    tpath = os.path.join(job, meta.get('tender', ''))
    sd = skill_dir_conf(conf)
    if not os.path.isfile(os.path.join(sd, 'SKILL.md')): sd = ensure_skill()
    prompt = (AGENT_PROMPT.replace('{mode}', MODE_AGENTS).replace('{skill}', sd)
              + ' 【本次为定向重做】只执行这条指令:「%s」。保留任务目录内其他既有产物;'
                '改写对应文件后,必须重新执行汇总成册与自检体检,更新自检报告。' % instruction)
    sub = lambda s: (s.replace('{tender}', tpath).replace('{out}', job)
                      .replace('{materials}', assets_dir()).replace('{jobid}', os.path.basename(jid))
                      .replace('{skill}', sd))
    raw = agent_cmd
    if isinstance(raw, list):
        # claude/codex/sowork:命令里的长提示词参数(含 SKILL.md 路径)整体换成定向版
        cmd = [(sub(prompt) if ('SKILL.md' in a or len(a) > 300) else sub(a)) for a in raw]
    else:
        # 自定义命令:模板原样跑,定向指令按执行层合同写进 inbox 由 agent 消费
        open(os.path.join(job, 'inbox.jsonl'), 'a', encoding='utf-8').write(
            json.dumps({'type': 'redo', 'instruction': instruction}, ensure_ascii=False) + '\n')
        cmd = sub(raw)
    cmd = login_shell_wrap(cmd, conf.get('engine') or {})
    emit(job, {'type': 'progress', 'stage': '定向重做启动', 'pct': 5, 'step': 1, 'total': 12})
    threading.Thread(target=real_agent, args=(job, cmd), daemon=True).start()
    return {'ok': True, 'mode': 'agent'}

def route_command(job, jid, text, running):
    """对话即遥控器:把自然语言识别成任务指令。可逆的(暂停/继续)直接执行;
    重活(整任务重启/定向重做)回一条带确认按钮的消息,点了才动手——不静默执行。
    疑问句一律不当指令,落回正常问答。"""
    t = (text or '').strip()
    if not t or t.endswith(('?', '?', '吗', '么')): return False
    if running and re.match(r'^(暂停|停一下|先停|暂停一下|先暂停)', t):
        meta = read_json(os.path.join(job, '任务.json'), {}); meta['paused'] = True
        write_json(os.path.join(job, '任务.json'), meta)
        emit(job, {'type': 'message', 'role': 'agent', 'text': '好,已暂停。说「继续」随时接着跑。'})
        return True
    if running and re.match(r'^(继续|接着跑|恢复|继续生成|接着写)', t):
        meta = read_json(os.path.join(job, '任务.json'), {}); meta['paused'] = False
        write_json(os.path.join(job, '任务.json'), meta)
        emit(job, {'type': 'message', 'role': 'agent', 'text': '已继续。'})
        return True
    targeted = re.search(r'第.{1,6}(章|节|步|部分)|某一步|目录|封面|报价|偏离表|自检', t)
    if re.search(r'重新启动|重新生成|整个重|重跑|再来一遍|全部重来', t) and not targeted:
        emit(job, {'type': 'message', 'role': 'agent',
                   'text': '要用同一份招标文件重新生成整个任务吗?会新开一个任务开始跑,当前任务和产物都保留。',
                   'actions': [{'act': 'rerun', 'label': '确认重新生成'}]})
        return True
    if (not running) and (targeted or re.match(r'^(重写|改写|扩写|重做|补写|重新输出|修改)', t)) \
            and re.search(r'重写|改写|扩写|重做|补写|重新输出|修改|重新写', t):
        emit(job, {'type': 'message', 'role': 'agent',
                   'text': '收到定向指令:「%s」。确认后我在当前任务里只重做这一部分,其余产物保留,完成后重新汇总并更新自检。' % t[:80],
                   'actions': [{'act': 'redo', 'label': '开始定向重做', 'param': t[:500]}]})
        return True
    return False

@app.post('/v1/jobs/{jid}/messages')
async def message(jid: str, req: Request):
    body = await req.json()
    job = jpath(jid); text = body.get('content', '')
    emit(job, {'type': 'message', 'role': 'user', 'text': text})
    if route_command(job, jid, text, os.path.basename(jid) in RUNNING):
        return {'ok': True}
    if os.path.basename(jid) not in RUNNING:
        # 任务已结束:不管生成引擎是哪种,都用已配模型基于产出回答(没配模型则给出指引);
        # thinking 状态让前端立刻显示"正在回复…",答案/失败原因随后必到
        emit(job, {'type': 'status', 'state': 'thinking'})
        threading.Thread(target=chat_reply, args=(job, jid, text), daemon=True).start()
    elif not config_agent_cmd():
        emit(job, {'type': 'message', 'role': 'agent', 'text': '收到:「%s」。已纳入当前章节,继续推进。' % text})
    else:
        open(os.path.join(job, 'inbox.jsonl'), 'a', encoding='utf-8').write(json.dumps(body, ensure_ascii=False) + '\n')
        # 真实 agent 收件没有即时回声,给一条轻量回执,用户不至于以为消息丢了
        emit(job, {'type': 'message', 'role': 'sys', 'text': '已送达正在写标书的 agent,会在合适的节点回应'})
    return {'ok': True}

@app.post('/v1/jobs/{jid}/answers')
async def answer(jid: str, req: Request):
    body = await req.json(); job = jpath(jid)
    # 先关问题:事件流里记下"该问题已答",重连/切任务回放时选项不再复活
    emit(job, {'type': 'question_closed', 'id': body.get('question_id') or ''})
    emit(job, {'type': 'message', 'role': 'user', 'text': body.get('choice') or body.get('text', '')})
    emit(job, {'type': 'message', 'role': 'agent', 'text': '好,按「%s」处理,继续。' % (body.get('choice') or body.get('text', ''))})
    open(os.path.join(job, 'answers.jsonl'), 'a', encoding='utf-8').write(json.dumps(body, ensure_ascii=False) + '\n')
    return {'ok': True}

@app.post('/v1/jobs/{jid}/control')
async def control(jid: str, req: Request):
    body = await req.json(); job = jpath(jid)
    meta = read_json(os.path.join(job, '任务.json'), {})
    meta['paused'] = body.get('action') == 'pause'
    write_json(os.path.join(job, '任务.json'), meta)
    emit(job, {'type': 'message', 'role': 'agent', 'text': '已暂停,随时继续。' if meta['paused'] else '继续跑。'})
    return {'ok': True}

@app.get('/v1/jobs/{jid}/artifacts')
def artifacts(jid: str):
    job = jpath(jid); out = []
    if os.path.isdir(job):
        for fn in list_deliverables(job):
            info = artifact_info(fn)
            out.append({'name': fn, 'url': '/v1/jobs/%s/artifacts/%s' % (jid, fn),
                        'size_kb': round(os.path.getsize(os.path.join(job, fn)) / 1024, 1), **info})
    return sorted(out, key=lambda a: (a['group'], a['rank'], a['name']))

@app.get('/v1/jobs/{jid}/artifacts/{fn}')
def download(jid: str, fn: str):
    path = _artifact_path(jid, fn)
    if not path: return JSONResponse({'ok': False, 'error': '文件不存在'}, 404)
    return FileResponse(path, filename=os.path.basename(path))

def _artifact_path(jid, name):
    """只允许访问任务根目录中已登记的交付物，阻止 ../ 与任意本机路径。"""
    raw = str(name or '')
    safe = os.path.basename(raw)
    job = jpath(jid)
    if not safe or safe != raw or not os.path.isdir(job) or safe not in list_deliverables(job): return None
    path = os.path.realpath(os.path.join(job, safe))
    return path if os.path.dirname(path) == os.path.realpath(job) and os.path.isfile(path) else None

def _open_local(path, reveal=False):
    if sys.platform == 'darwin': subprocess.Popen(['open', '-R', path] if reveal else ['open', path])
    elif os.name == 'nt':
        if reveal: subprocess.Popen(['explorer', '/select,%s' % path])
        else: os.startfile(path)  # noqa
    else: subprocess.Popen(['xdg-open', os.path.dirname(path) if reveal else path])

@app.post('/v1/jobs/{jid}/artifacts/open')
async def open_artifact(jid: str, req: Request):
    if MULTIUSER: return JSONResponse({'ok': False, 'error': '云端模式不支持打开本机文件'}, 403)
    body = await req.json(); path = _artifact_path(jid, body.get('name'))
    if not path: return JSONResponse({'ok': False, 'error': '文件不存在或不属于当前任务'}, 404)
    try:
        _open_local(path, bool(body.get('reveal')))
        return {'ok': True, 'path': path}
    except Exception as e:
        return JSONResponse({'ok': False, 'error': str(e), 'path': path}, 500)

@app.post('/v1/jobs/{jid}/open_folder')
def open_job_folder(jid: str):
    if MULTIUSER: return JSONResponse({'ok': False, 'error': '云端模式不支持打开本机文件夹'}, 403)
    job = jpath(jid)
    if not os.path.isdir(job): return JSONResponse({'ok': False, 'error': '任务目录不存在'}, 404)
    try:
        _open_local(job)
        return {'ok': True, 'path': job}
    except Exception as e:
        return JSONResponse({'ok': False, 'error': str(e), 'path': job}, 500)

@app.get('/v1/providers')
def providers():
    return read_json(conf_path(), {'providers': [], 'routing': {}}).get('providers', [])

@app.delete('/v1/providers/{pid}')
def del_provider(pid: str):
    conf = read_json(conf_path(), {'providers': [], 'routing': {}})
    conf['providers'] = [p for p in conf['providers'] if p.get('id') != pid]
    if (conf.get('routing') or {}).get('default') == pid:
        conf['routing'] = {'default': conf['providers'][0]['id'], 'model': conf['providers'][0].get('model', '')} if conf['providers'] else {}
    write_json(conf_path(), conf)
    return {'ok': True}

@app.post('/v1/providers')
async def add_provider(req: Request):
    body = await req.json()
    conf = read_json(conf_path(), {'providers': [], 'routing': {}})
    body['id'] = body.get('id') or uuid.uuid4().hex[:8]
    # 同一网关+同一模型视为同一个接入点:覆盖而不是新增(避免重复添加堆积一长串)
    same = lambda p: (p.get('base_url'), p.get('model', '')) == (body.get('base_url'), body.get('model', ''))
    dup = next((p for p in conf['providers'] if same(p)), None)
    if dup: body['id'] = dup['id']
    # 生产环境:api_key 应转存系统钥匙串;此处存本地配置仅为最小可用
    conf['providers'] = [p for p in conf['providers'] if p.get('id') != body['id'] and not same(p)] + [body]
    if not (conf.get('routing') or {}).get('default'):
        conf['routing'] = {'default': body['id'], 'model': body.get('model', '')}
    write_json(conf_path(), conf)
    return {'id': body['id']}

def net_hint(e):
    """把底层网络异常翻译成可操作的中文提示"""
    s = str(e)
    if 'CERTIFICATE_VERIFY' in s or 'certificate verify failed' in s:
        return ('HTTPS 证书校验失败(已尝试系统证书与内置根证书)。常见于公司网络代理拦截 HTTPS 或内网自签名网关;'
                '若确认该网关可信,勾选「跳过证书校验」后重试。原始信息:%s' % s)
    if 'Name or service not known' in s or 'nodename nor servname' in s or 'getaddrinfo' in s:
        return '域名解析失败:请检查 Base URL 拼写与本机网络/VPN。原始信息:%s' % s
    if 'timed out' in s or 'timeout' in s.lower():
        return '连接超时:网关不可达或网络受限(公司网络可能需代理)。原始信息:%s' % s
    if 'Connection refused' in s:
        return '连接被拒绝:端口/地址不对,或服务未启动。原始信息:%s' % s
    return s

def _ssl_ctx(kind):
    """default=系统/环境 CA;certifi=内置根证书(打包版 macOS 必需);none=不校验(仅内网自签名)"""
    if kind == 'none':
        c = ssl.create_default_context(); c.check_hostname = False; c.verify_mode = ssl.CERT_NONE; return c
    if kind == 'certifi':
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()

def _openai_req(base, key, path, payload=None, timeout=30, verify=True):
    hdr = {'Authorization': 'Bearer ' + (key or ''), 'User-Agent': 'bid-assistant/0.9'}
    data = None
    if payload is not None:
        hdr['Content-Type'] = 'application/json'
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request((base or '').rstrip('/') + path, data=data, headers=hdr)
    kinds = ['default', 'certifi'] if verify else ['none']
    last = None
    for kind in kinds:
        try:
            ctx = _ssl_ctx(kind)
        except Exception:
            continue  # 该环境没有 certifi
        try:
            return json.loads(urllib.request.urlopen(req, timeout=timeout, context=ctx).read().decode('utf-8', 'ignore'))
        except urllib.error.URLError as e:
            # 仅证书类失败才换 CA 重试;其他错误(401/超时/DNS)直接抛
            if not isinstance(getattr(e, 'reason', None), ssl.SSLCertVerificationError): raise
            last = e
    raise last

@app.post('/v1/providers/probe_models')
async def probe_models(req: Request):
    """不落库:用 base_url+key 拉取该网关可用模型列表(供添加前选择你套餐里的模型)"""
    body = await req.json()
    if not body.get('base_url'): return JSONResponse({'ok': False, 'error': '缺 base_url', 'models': []}, 400)
    base, key, verify = body['base_url'], body.get('api_key', ''), body.get('verify_ssl', True)
    hit = _models_cached(base, key, verify)
    if hit: return hit
    try:
        # 阻塞网络请求丢线程池:这是 async 端点,直接跑会卡住整个事件循环(页面全体转圈的元凶之一)
        data = await asyncio.to_thread(_openai_req, base, key, '/models', timeout=15, verify=verify)
        ids = [m.get('id') for m in (data.get('data') or []) if m.get('id')]
        _models_store(base, key, verify, ids)
        return {'ok': True, 'models': ids}
    except urllib.error.HTTPError as e:
        return {'ok': False, 'error': 'HTTP %s %s' % (e.code, e.read()[:200].decode('utf-8', 'ignore')), 'models': []}
    except Exception as e:
        return {'ok': False, 'error': net_hint(e), 'models': []}

@app.post('/v1/providers/{pid}/test')
def test_provider(pid: str):
    """配了模型→真发一次对话请求(验证你的 token 套餐对该模型可用);没配→仅探 /models 连通"""
    conf = read_json(conf_path(), {'providers': []})
    p = next((x for x in conf['providers'] if x.get('id') == pid), None)
    if not p: return JSONResponse({'ok': False, 'error': 'not found'}, 404)
    t0 = time.time(); vs = p.get('verify_ssl', True)
    try:
        if p.get('model'):
            resp = _openai_req(p.get('base_url'), p.get('api_key'), '/chat/completions',
                               {'model': p['model'], 'messages': [{'role': 'user', 'content': 'ping,只回复:pong'}], 'max_tokens': 8},
                               timeout=45, verify=vs)
            reply = ((resp.get('choices') or [{}])[0].get('message') or {}).get('content', '')
            return {'ok': True, 'latency_ms': int((time.time() - t0) * 1000), 'model': resp.get('model', p['model']), 'reply': (reply or '')[:40]}
        _openai_req(p.get('base_url'), p.get('api_key'), '/models', timeout=15, verify=vs)
        return {'ok': True, 'latency_ms': int((time.time() - t0) * 1000), 'note': '通道连通;未配模型,建议选择模型后重测'}
    except urllib.error.HTTPError as e:
        return {'ok': False, 'error': 'HTTP %s %s' % (e.code, e.read()[:300].decode('utf-8', 'ignore'))}
    except Exception as e:
        return {'ok': False, 'error': net_hint(e)}

# ================= Responses ↔ Chat 中转:让 Codex CLI 直接用我们自己的 S2 网关 =================
# 背景(实测,codex-cli 0.146.0):Codex 支持自定义模型供应商(CODEX_HOME/config.toml 里的
# [model_providers.*] + base_url + env_key),但**只认 Responses API**——`wire_api = "chat"`
# 已被移除,填了会直接报错退出。而我们的 S2 网关(以及绝大多数国产 OpenAI 兼容网关)只有
# /chat/completions。所以这里做一层协议翻译,并且刻意放进「已经随 App 分发的这个引擎」里:
# 不多装一个进程、不多开一个端口、不改客户机器的 ~/.codex —— 客户那边只是多填一个 Key。
S2_DEFAULT_BASE = 'https://api.senseaudio.cn/v1'
S2_DEFAULT_MODEL = 'senseaudio-s2'
SELF_PORT = int(os.environ.get('PORT', 8080))
RELAY_LAST = {}      # 最近一次中转的结果:出问题时「测试连接」和运行日志能说清卡在哪一层

# 模型列表短缓存:重复打开设置面板不再反复打网关(慢且费额度);TTL 默认 120s,BID_MODELS_TTL=0 关闭
_MODELS_CACHE, _MODELS_LOCK = {}, threading.Lock()
_MODELS_TTL = int(os.environ.get('BID_MODELS_TTL', 120))

def _models_cached(base, key, verify):
    if _MODELS_TTL <= 0: return None
    k = (base or '').rstrip('/') + '|' + hashlib.sha1((key or '').encode()).hexdigest()[:12] + '|' + str(bool(verify))
    with _MODELS_LOCK:
        v = _MODELS_CACHE.get(k)
        if v and time.time() - v[0] < _MODELS_TTL:
            return {'ok': True, 'models': list(v[1]), 'cached': True}
    return None

def _models_store(base, key, verify, ids):
    k = (base or '').rstrip('/') + '|' + hashlib.sha1((key or '').encode()).hexdigest()[:12] + '|' + str(bool(verify))
    with _MODELS_LOCK:
        _MODELS_CACHE[k] = (time.time(), list(ids))

def relay_token():
    """本机中转口令:只有我们自己拉起的 Codex 拿得到,别的进程调不动你的 Key"""
    conf = read_json(conf_path(), {})
    t = (conf.get('relay_token') or '').strip()
    if not t:
        t = secrets.token_hex(16)
        conf['relay_token'] = t
        write_json(conf_path(), conf)
    return t

def s2_conf(conf=None):
    """S2 上游:优先取「生成引擎」里填的;留空就借用「模型接入」里已经配好的那个网关,免得同一个 Key 填两遍"""
    conf = conf if conf is not None else read_json(conf_path(), {})
    eng = conf.get('engine') or {}
    base = (eng.get('s2_base_url') or '').strip()
    key = (eng.get('s2_key') or '').strip()
    model = (eng.get('s2_model') or '').strip()
    if not (base and key):
        ps = conf.get('providers') or []
        rid = (conf.get('routing') or {}).get('default')
        p = next((x for x in ps if x.get('id') == rid), None) or (ps[0] if ps else None)
        if p:
            base, key = base or (p.get('base_url') or '').strip(), key or (p.get('api_key') or '').strip()
            model = model or (p.get('model') or '').strip()
    return {'base_url': (base or S2_DEFAULT_BASE).rstrip('/'), 'api_key': key,
            'model': model or S2_DEFAULT_MODEL, 'verify_ssl': eng.get('s2_verify_ssl', True),
            'wire': (eng.get('s2_wire') or 'auto')}

ROLE_MAP = {'developer': 'system', 'system': 'system', 'user': 'user', 'assistant': 'assistant', 'tool': 'tool'}

def _chat_content(content):
    """Responses 的 content 数组 → chat 的 content。带图时转成多模态数组,否则并成一段纯文本"""
    if isinstance(content, str): return content
    texts, parts, has_img = [], [], False
    for c in (content or []):
        if isinstance(c, str): texts.append(c); parts.append({'type': 'text', 'text': c}); continue
        t = c.get('type') or ''
        if t in ('input_text', 'output_text', 'text', 'summary_text'):
            s = c.get('text') or ''
            texts.append(s); parts.append({'type': 'text', 'text': s})
        elif t in ('input_image', 'image_url'):
            u = c.get('image_url')
            u = u.get('url') if isinstance(u, dict) else u
            if u: has_img = True; parts.append({'type': 'image_url', 'image_url': {'url': u}})
    return parts if has_img else '\n'.join(x for x in texts if x)

def resp_to_chat(body, model):
    """Codex 的 Responses 请求 → chat/completions 请求。返回 (payload, 丢弃的工具类型)"""
    msgs = []
    if body.get('instructions'): msgs.append({'role': 'system', 'content': body['instructions']})
    inp = body.get('input')
    if isinstance(inp, str): inp = [{'type': 'message', 'role': 'user', 'content': inp}]
    for it in (inp or []):
        if isinstance(it, str): msgs.append({'role': 'user', 'content': it}); continue
        t = it.get('type') or 'message'
        if t == 'message':
            c = _chat_content(it.get('content'))
            if c: msgs.append({'role': ROLE_MAP.get(it.get('role') or 'user', 'user'), 'content': c})
        elif t == 'function_call':
            msgs.append({'role': 'assistant', 'content': '', 'tool_calls': [
                {'id': it.get('call_id') or it.get('id') or '', 'type': 'function',
                 'function': {'name': it.get('name') or '', 'arguments': it.get('arguments') or '{}'}}]})
        elif t == 'function_call_output':
            out = it.get('output')
            if isinstance(out, (dict, list)): out = json.dumps(out, ensure_ascii=False)
            msgs.append({'role': 'tool', 'tool_call_id': it.get('call_id') or '', 'content': out or ''})
        # reasoning / web_search_call 等本地专属条目:chat 协议没有对应位置,丢掉不影响续跑
    tools, dropped = [], []
    def add(f):
        tools.append({'type': 'function', 'function': {
            'name': f.get('name') or '', 'description': (f.get('description') or '')[:2048],
            'parameters': f.get('parameters') or {'type': 'object', 'properties': {}}}})
    for t in (body.get('tools') or []):
        ty = t.get('type')
        if ty == 'function': add(t)
        elif ty == 'namespace':                 # 子 agent 之类的命名空间工具:摊平成同名普通函数
            for c in (t.get('tools') or []):
                add(c) if c.get('type') == 'function' else dropped.append(c.get('type') or '?')
        else: dropped.append(ty or '?')         # web_search 等网关侧内建工具:上游没有,只能丢
    seen, uniq = set(), []
    for f in tools:
        n = f['function']['name']
        if n and n not in seen: seen.add(n); uniq.append(f)
    payload = {'model': model, 'messages': msgs, 'stream': True}
    if uniq:
        payload['tools'] = uniq
        payload['tool_choice'] = body.get('tool_choice') if body.get('tool_choice') in ('auto', 'none', 'required') else 'auto'
        if body.get('parallel_tool_calls') is not None: payload['parallel_tool_calls'] = bool(body['parallel_tool_calls'])
    return payload, dropped

def sse(ev, data):
    return ('event: %s\ndata: %s\n\n' % (ev, json.dumps(data, ensure_ascii=False))).encode('utf-8')

def _upstream(base, key, path, payload, timeout, verify):
    """发上游请求并返回未读完的连接(用于流式读取);证书失败时按 _openai_req 的策略换 CA 重试"""
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(base.rstrip('/') + path, data=data, headers={
        'Authorization': 'Bearer ' + (key or ''), 'Content-Type': 'application/json',
        'Accept': 'text/event-stream' if payload.get('stream') else 'application/json',
        'User-Agent': 'bid-dog-relay/' + ENGINE_VERSION})
    last = None
    for kind in (['default', 'certifi'] if verify else ['none']):
        try: ctx = _ssl_ctx(kind)
        except Exception: continue
        try: return urllib.request.urlopen(req, timeout=timeout, context=ctx)
        except urllib.error.URLError as e:
            if not isinstance(getattr(e, 'reason', None), ssl.SSLCertVerificationError): raise
            last = e
    raise last

def _relay_stream(body, up):
    """一次 Codex 轮次:上游 chat 流 → Responses 事件流。
    任何一层失败都要发 response.failed,不能静默——静默失败是这个产品最贵的 bug 类型。"""
    rid = 'resp_' + uuid.uuid4().hex[:20]
    mid = 'msg_' + uuid.uuid4().hex[:16]
    yield sse('response.created', {'type': 'response.created', 'response': {'id': rid, 'status': 'in_progress'}})
    payload, dropped = resp_to_chat(body, up['model'])
    text, calls, usage, err, opened = [], {}, {}, '', [False]
    def open_msg():
        """先 output_item.added 再发 delta——否则 codex 会刷屏 OutputTextDelta without active item"""
        opened[0] = True
        return sse('response.output_item.added', {'type': 'response.output_item.added', 'output_index': 0,
                   'item': {'type': 'message', 'id': mid, 'role': 'assistant', 'status': 'in_progress', 'content': []}})
    RELAY_LAST.update({'ts': now(), 'model': up['model'], 'msgs': len(payload['messages']),
                       'tools': len(payload.get('tools') or []), 'dropped_tools': dropped, 'error': ''})
    try:
        try:
            r = _upstream(up['base_url'], up['api_key'], '/chat/completions', payload, 900, up['verify_ssl'])
        except urllib.error.HTTPError as e:
            det = e.read()[:400].decode('utf-8', 'ignore')
            # 有的网关不支持工具或不支持流式:退一步再试一次,总比整条任务断掉强
            if e.code in (400, 404, 422) and payload.get('stream'):
                payload['stream'] = False
                r = _upstream(up['base_url'], up['api_key'], '/chat/completions', payload, 900, up['verify_ssl'])
            else:
                raise RuntimeError('HTTP %s %s' % (e.code, det))
        # 有的网关不理会 stream:true、直接回整包 JSON —— 按响应头判断,别按我们的请求猜
        ct = (r.headers.get('Content-Type') or '').lower()
        if payload.get('stream') and 'json' not in ct:
            for raw in r:
                ln = raw.decode('utf-8', 'ignore').strip()
                if not ln.startswith('data:'): continue
                ln = ln[5:].strip()
                if ln == '[DONE]': break
                try: d = json.loads(ln)
                except Exception: continue
                if d.get('usage'): usage = d['usage']
                ch = (d.get('choices') or [{}])[0]
                delta = ch.get('delta') or {}
                if delta.get('content'):
                    if not opened[0]: yield open_msg()
                    text.append(delta['content'])
                    yield sse('response.output_text.delta', {'type': 'response.output_text.delta',
                                                             'item_id': mid, 'output_index': 0, 'delta': delta['content']})
                # reasoning_content(思考过程)不转发:codex 侧本来就 hide_agent_reasoning,转过去只会多一类协议噪声
                for tc in (delta.get('tool_calls') or []):
                    i = tc.get('index', 0)
                    c = calls.setdefault(i, {'id': '', 'name': '', 'args': ''})
                    if tc.get('id'): c['id'] = tc['id']
                    fn = tc.get('function') or {}
                    if fn.get('name'): c['name'] = fn['name']
                    if fn.get('arguments'): c['args'] += fn['arguments']
        else:
            d = json.loads(r.read().decode('utf-8', 'ignore'))
            usage = d.get('usage') or {}
            m = ((d.get('choices') or [{}])[0].get('message') or {})
            if m.get('content'):
                text.append(m['content'])
                yield open_msg()
                yield sse('response.output_text.delta', {'type': 'response.output_text.delta',
                                                         'item_id': mid, 'output_index': 0, 'delta': m['content']})
            for i, tc in enumerate(m.get('tool_calls') or []):
                fn = tc.get('function') or {}
                calls[i] = {'id': tc.get('id') or '', 'name': fn.get('name') or '', 'args': fn.get('arguments') or '{}'}
    except Exception as e:
        err = net_hint(e)
    if err:
        RELAY_LAST['error'] = err
        yield sse('response.failed', {'type': 'response.failed', 'response': {'id': rid, 'status': 'failed',
                  'error': {'code': 'upstream_error', 'message': '中标狗中转层:调用你的 S2 网关失败 —— ' + err}}})
        return
    idx = 0
    body_txt = ''.join(text).strip()
    if body_txt:
        if not opened[0]: yield open_msg()
        yield sse('response.output_text.done', {'type': 'response.output_text.done', 'item_id': mid,
                                                'output_index': 0, 'text': body_txt})
        yield sse('response.output_item.done', {'type': 'response.output_item.done', 'output_index': idx,
                  'item': {'type': 'message', 'id': mid, 'role': 'assistant',
                           'status': 'completed', 'content': [{'type': 'output_text', 'text': body_txt}]}})
        idx += 1
    for i in sorted(calls):
        c = calls[i]
        if not c['name']: continue
        cid = c['id'] or ('call_' + uuid.uuid4().hex[:16])
        yield sse('response.output_item.done', {'type': 'response.output_item.done', 'output_index': idx,
                  'item': {'type': 'function_call', 'id': 'fc_' + uuid.uuid4().hex[:16], 'call_id': cid,
                           'name': c['name'], 'arguments': c['args'] or '{}', 'status': 'completed'}})
        idx += 1
    it, ot = int(usage.get('prompt_tokens') or 0), int(usage.get('completion_tokens') or 0)
    RELAY_LAST.update({'in': it, 'out': ot, 'calls': [calls[i]['name'] for i in sorted(calls)], 'chars': len(body_txt)})
    yield sse('response.completed', {'type': 'response.completed', 'response': {'id': rid, 'status': 'completed',
              'usage': {'input_tokens': it, 'output_tokens': ot,
                        'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0},
                        'total_tokens': int(usage.get('total_tokens') or (it + ot))}}})

def _relay_passthrough(body, up):
    """上游本身就有 /responses(比如以后 S2 网关补齐了):原样透传,一个字节都不翻译,最省事也最保真"""
    try:
        r = _upstream(up['base_url'], up['api_key'], '/responses', body, 900, up['verify_ssl'])
    except Exception as e:
        RELAY_LAST.update({'ts': now(), 'error': net_hint(e), 'mode': 'passthrough'})
        yield sse('response.failed', {'type': 'response.failed', 'response': {'id': 'resp_err', 'status': 'failed',
                  'error': {'code': 'upstream_error', 'message': '中标狗中转层(直通模式):' + net_hint(e)}}})
        return
    while True:
        chunk = r.read(8192)
        if not chunk: break
        yield chunk

@app.post('/v1/relay/responses')
async def relay_responses(req: Request):
    if (req.headers.get('authorization') or '').replace('Bearer ', '').strip() != relay_token():
        return JSONResponse({'error': 'relay token 不匹配'}, 401)
    body = await req.json()
    up = s2_conf()
    if not up['api_key']:
        return JSONResponse({'error': '还没填 S2 API Key(设置 · 生成引擎)'}, 400)
    up['model'] = up['model'] or body.get('model') or S2_DEFAULT_MODEL
    gen = _relay_passthrough(body, up) if up['wire'] == 'responses' else _relay_stream(body, up)
    return StreamingResponse(gen, media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.post('/v1/relay/chat/completions')
async def relay_chat(req: Request):
    """纯直通(零翻译):opencode 等原生 OpenAI 兼容外壳 → 这里 → S2 网关。
    存在的唯一理由是 Key 托管:子进程只拿本机随机口令,真 Key 不出引擎进程;顺带统一记账 RELAY_LAST。"""
    if (req.headers.get('authorization') or '').replace('Bearer ', '').strip() != relay_token():
        return JSONResponse({'error': {'message': 'relay token 不匹配', 'type': 'auth_error'}}, 401)
    body = await req.json()
    up = s2_conf()
    if not up['api_key']:
        return JSONResponse({'error': {'message': '还没填 S2 API Key(设置 · 生成引擎)', 'type': 'config_error'}}, 400)
    body['model'] = up['model'] or body.get('model')
    RELAY_LAST.update({'ts': now(), 'mode': 'chat-pass', 'model': body.get('model'),
                       'msgs': len(body.get('messages') or []), 'tools': len(body.get('tools') or []), 'error': ''})
    def gen(r):
        try:
            while True:
                c = r.read(8192)
                if not c: break
                yield c
        except Exception:
            return
    try:
        r = await asyncio.to_thread(_upstream, up['base_url'], up['api_key'], '/chat/completions', body, 900, up['verify_ssl'])
    except urllib.error.HTTPError as e:
        det = e.read()[:400].decode('utf-8', 'ignore')
        RELAY_LAST['error'] = 'HTTP %s %s' % (e.code, det)
        try: return JSONResponse(json.loads(det), e.code)
        except Exception:
            return JSONResponse({'error': {'message': 'HTTP %s %s' % (e.code, det), 'type': 'upstream_error'}}, e.code)
    except Exception as e:
        RELAY_LAST['error'] = net_hint(e)
        return JSONResponse({'error': {'message': '中转层:' + net_hint(e), 'type': 'upstream_error'}}, 502)
    ct = r.headers.get('Content-Type') or 'application/json'
    return StreamingResponse(gen(r), media_type=ct,
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.get('/v1/relay/models')
def relay_models():
    up = s2_conf()
    hit = _models_cached(up['base_url'], up['api_key'], up['verify_ssl'])
    if hit: return hit
    try:
        d = _openai_req(up['base_url'], up['api_key'], '/models', timeout=15, verify=up['verify_ssl'])
        ids = [m.get('id') for m in (d.get('data') or []) if m.get('id')]
        _models_store(up['base_url'], up['api_key'], up['verify_ssl'], ids)
        return {'ok': True, 'models': ids}
    except Exception as e:
        return JSONResponse({'error': net_hint(e)}, 502)

# ---------- 一键安装执行外壳(Codex CLI):没内置、没装 Node 的机器,点一下按钮就好 ----------
# 版本钉死在我们测过兼容的那个:S2 中转是按它的 Responses 行为实测的,随手升级可能翻车
CODEX_PIN = os.environ.get('BID_CODEX_VERSION', '0.146.0')
OPENCODE_PIN = os.environ.get('BID_OPENCODE_VERSION', '1.18.13')   # 与直连实测配套的版本
# opencode 平台包是普通 npm 包名(非别名):tarball = {reg}/{pkg}/-/{pkg}-{ver}.tgz,包内 package/bin/opencode[.exe]
OPENCODE_PLAT = {
    ('darwin', 'arm64'):  'opencode-darwin-arm64',
    ('darwin', 'x86_64'): 'opencode-darwin-x64',
    ('win32',  'amd64'):  'opencode-windows-x64',
    ('win32',  'arm64'):  'opencode-windows-arm64',
    ('linux',  'x86_64'): 'opencode-linux-x64',
    ('linux',  'aarch64'): 'opencode-linux-arm64',
}

def _plat_key():
    import platform as _pl
    mach = (_pl.machine() or '').lower()
    mach = {'x86_64': 'x86_64', 'amd64': 'amd64' if sys.platform == 'win32' else 'x86_64',
            'arm64': 'arm64', 'aarch64': 'arm64' if sys.platform == 'darwin' else 'aarch64'}.get(mach, mach)
    return (sys.platform if sys.platform != 'cygwin' else 'win32', mach)

def _shell_meta(which):
    # 外壳下载参数:('codex'|'opencode') -> (url构造器, 包内路径, 目标文件名, 手装提示);不支持的平台返回 None
    ext = '.exe' if os.name == 'nt' else ''
    if which == 'opencode':
        pkg = OPENCODE_PLAT.get(_plat_key())
        if not pkg: return None
        return (lambda reg: '%s/%s/-/%s-%s.tgz' % (reg.rstrip('/'), pkg, pkg, OPENCODE_PIN),
                'package/bin/opencode' + ext, 'opencode-cli' + ext, 'npm i -g opencode-ai')
    plat = CODEX_PLAT.get(_plat_key())
    if not plat: return None
    suffix, triple = plat
    return (lambda reg: '%s/@openai/codex/-/codex-%s-%s.tgz' % (reg.rstrip('/'), CODEX_PIN, suffix),
            'package/vendor/%s/bin/codex%s' % (triple, ext), 'codex-cli' + ext, 'npm i -g @openai/codex')
# 平台 → (npm 版本后缀, 包内 vendor 三元组)。npm 的平台包是别名:@openai/codex@<版本>-<平台>
CODEX_PLAT = {
    ('darwin', 'arm64'):  ('darwin-arm64',  'aarch64-apple-darwin'),
    ('darwin', 'x86_64'): ('darwin-x64',    'x86_64-apple-darwin'),
    ('win32',  'amd64'):  ('win32-x64',     'x86_64-pc-windows-msvc'),
    ('win32',  'arm64'):  ('win32-arm64',   'aarch64-pc-windows-msvc'),
    ('linux',  'x86_64'): ('linux-x64',     'x86_64-unknown-linux-musl'),
    ('linux',  'aarch64'): ('linux-arm64',  'aarch64-unknown-linux-musl'),
}
# 国内客户下 npmjs 常年龟速:先走 npmmirror,再退回官源(路径格式两家一致)
CODEX_REGISTRIES = ([os.environ.get('BID_CODEX_REGISTRY')] if os.environ.get('BID_CODEX_REGISTRY') else
                    ['https://registry.npmmirror.com', 'https://registry.npmjs.org'])
PROV = {'state': 'idle', 'pct': 0, 'note': '', 'path': '', 'error': ''}

def codex_platform():
    import platform as _pl
    mach = (_pl.machine() or '').lower()
    mach = {'x86_64': 'x86_64', 'amd64': 'amd64' if sys.platform == 'win32' else 'x86_64',
            'arm64': 'arm64', 'aarch64': 'arm64' if sys.platform == 'darwin' else 'aarch64'}.get(mach, mach)
    return CODEX_PLAT.get((sys.platform if sys.platform != 'cygwin' else 'win32', mach))

def _provision_codex(which='codex'):
    meta = _shell_meta(which)
    if not meta:
        PROV.update({'state': 'error', 'error': '暂不支持这个系统架构,请手动安装外壳'}); return
    mk_url, inner, exe, manual = meta
    dstdir = _mk(os.path.join(DATA, 'bin'))
    dst = os.path.join(dstdir, exe)
    tmp = os.path.join(dstdir, '_shell.tgz')
    last = ''
    for reg in CODEX_REGISTRIES:
        url = mk_url(reg)
        try:
            PROV.update({'state': 'running', 'which': which, 'pct': 0, 'note': '正在下载执行外壳(%s)…' % which, 'error': ''})
            req = urllib.request.Request(url, headers={'User-Agent': 'bid-dog/' + ENGINE_VERSION})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, 'wb') as f:
                total = int(r.headers.get('Content-Length') or 0)
                got = 0
                while True:
                    chunk = r.read(1 << 18)
                    if not chunk: break
                    f.write(chunk); got += len(chunk)
                    if total: PROV['pct'] = int(got * 80 / total)   # 下载占 80%,解压校验占 20%
            PROV.update({'pct': 82, 'note': '正在解压…'})
            import tarfile
            with tarfile.open(tmp, 'r:gz') as t:
                m = t.getmember(inner)
                m.name = os.path.basename(dst)                      # 只取这一个文件,落到 bin/ 平铺
                t.extract(m, dstdir)
            os.chmod(dst, 0o755)
            PROV.update({'pct': 92, 'note': '正在校验…'})
            r = subprocess.run([dst, '--version'], capture_output=True, text=True, timeout=30,
                               stdin=subprocess.DEVNULL, **DETACH)
            ver = (r.stdout or r.stderr or '').strip()
            if r.returncode != 0: raise RuntimeError('校验失败:%s' % ver[-200:])
            PROV.update({'state': 'done', 'pct': 100, 'path': dst, 'note': '已安装:%s' % (ver or exe)})
            try: os.remove(tmp)
            except Exception: pass
            return
        except Exception as e:
            last = net_hint(e)
            try: os.remove(tmp)
            except Exception: pass
    PROV.update({'state': 'error', 'error': '下载失败(镜像与官源都试过):%s。也可手动安装:%s' % (last, manual)})

@app.post('/v1/agent/provision')
async def agent_provision(req: Request):
    """一键安装执行外壳到数据目录(codex 约 130MB / opencode 约 80MB)。不碰系统目录,免管理员权限。
    已有可用外壳(内置或此前装过)则直接返回;文件坏了(跑不动 --version)会自动删掉重下。"""
    try: which = ((await req.json()).get('which') or 'codex')
    except Exception: which = 'codex'
    if which not in ('codex', 'opencode'): which = 'codex'
    if PROV['state'] == 'running': return PROV
    b = bundled_cli('opencode-cli' if which == 'opencode' else 'codex-cli')
    if b:
        try:
            r = subprocess.run([b, '--version'], capture_output=True, text=True, timeout=30,
                               stdin=subprocess.DEVNULL, **DETACH)
            if r.returncode == 0:
                PROV.update({'state': 'done', 'pct': 100, 'path': b,
                             'note': '已就绪:%s' % (r.stdout or '').strip()[:60]})
                return PROV
        except Exception: pass
        if os.path.dirname(b) == os.path.join(DATA, 'bin'):   # 只清我们自己下的,不动安装包内置的
            try: os.remove(b)
            except Exception: pass
    threading.Thread(target=_provision_codex, args=(which,), daemon=True).start()
    await asyncio.sleep(0.3)   # 让状态先落到 running,前端第一次轮询就有数
    return PROV

@app.get('/v1/agent/provision')
def agent_provision_status():
    return PROV

@app.get('/v1/relay/status')
def relay_status():
    up = s2_conf()
    return {'base_url': up['base_url'], 'model': up['model'], 'has_key': bool(up['api_key']),
            'wire': up['wire'], 'relay_url': relay_base(), 'last': RELAY_LAST}

def relay_base():
    return 'http://127.0.0.1:%d/v1/relay' % SELF_PORT

@app.put('/v1/routing')
async def routing(req: Request):
    conf = read_json(conf_path(), {'providers': [], 'routing': {}})
    conf['routing'] = await req.json(); write_json(conf_path(), conf)
    return {'ok': True}

@app.post('/v1/assets/config')
async def assets_config(req: Request):
    """更换素材库位置(留空 dir = 恢复默认)。原文件不搬迁,只是改指向,提示由前端给出"""
    body = await req.json()
    d = (body.get('dir') or '').strip()
    conf = read_json(conf_path(), {'providers': [], 'routing': {}})
    if d:
        d = os.path.expanduser(d)
        try: os.makedirs(d, exist_ok=True)
        except Exception as e:
            return JSONResponse({'ok': False, 'error': '这个路径建不出来:%s' % e}, 400)
        if not os.path.isdir(d) or not os.access(d, os.W_OK):
            return JSONResponse({'ok': False, 'error': '路径不可写,请换一个位置'}, 400)
        conf['assets_dir'] = d
    else:
        conf.pop('assets_dir', None)
    write_json(conf_path(), conf)
    return {'ok': True, 'folder': assets_dir(), 'default': assets_default(), 'is_default': not d}

@app.get('/v1/assets')
def assets():
    out = {'folder': assets_dir(), 'default': assets_default(),
           'is_default': not (json_quiet(conf_path()).get('assets_dir') or '').strip(), 'items': []}
    for root, _, files in os.walk(assets_dir()):
        for fn in files:
            if fn.startswith('.') or fn == '入库流水.jsonl': continue
            rel = os.path.relpath(os.path.join(root, fn), assets_dir())
            out['items'].append({'path': rel, 'category': rel.split(os.sep)[0] if os.sep in rel else '未分类'})
    try:
        lines = open(os.path.join(assets_dir(), '入库流水.jsonl'), encoding='utf-8').read().splitlines()
        out['recent'] = [json.loads(l) for l in lines[-5:]][::-1]
    except Exception:
        out['recent'] = []
    return out

@app.post('/v1/assets')
async def add_asset(file: UploadFile = File(...), category: str = Form('未分类')):
    d = os.path.join(assets_dir(), category); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, file.filename), 'wb').write(await file.read())
    return {'ok': True, 'path': os.path.join(category, file.filename)}

# ---------- 素材库 · 过往标书自动入库(确定性:拆图/拆章/归类;AI 增强走 AGENT_CMD) ----------
CAT_RULES = [
    ('公司介绍',   ['公司简介', '公司介绍', '企业概况', '企业简介', '关于我们', '公司概况']),
    ('产品资料',   ['产品', '技术方案', '系统架构', '技术架构', '功能', '平台', '解决方案', '总体设计', '系统设计', '技术路线']),
    ('资质与案例', ['资质', '证书', '荣誉', '案例', '业绩', '中标', '成功案例', '项目经验', '合同']),
    ('人员与团队', ['人员', '团队', '项目组', '组织架构', '简历', '项目经理']),
    ('服务承诺',   ['售后', '服务承诺', '培训', '质保', '维保', '服务方案', '运维', '应急']),
    ('商务文件',   ['应标信', '投标函', '授权', '承诺书', '偏离表', '报价']),
]

def classify(title):
    for cat, kws in CAT_RULES:
        if any(k in title for k in kws): return cat
    return '通用章节'

def split_md_sections(text):
    """按 markdown 标题拆章 → [(标题, 含标题的整章内容)];无标题则整文一节"""
    import re
    secs, cur_t, cur = [], None, []
    for ln in text.splitlines():
        m = re.match(r'^(#{1,3})\s+(.+)', ln)
        if m:
            if cur_t is not None or any(l.strip() for l in cur):
                secs.append((cur_t or '未命名章节', '\n'.join(cur).strip()))
            cur_t, cur = m.group(2).strip(), [ln]
        else:
            cur.append(ln)
    if cur_t is not None or any(l.strip() for l in cur):
        secs.append((cur_t or '未命名章节', '\n'.join(cur).strip()))
    return [(t, c) for t, c in secs if c.strip()]

def docx_to_sections_and_images(path, img_dir):
    """docx → (按标题拆分的章节, 提取出的图片文件名);表格转 markdown 表"""
    import hashlib
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    from docx.oxml.ns import qn
    doc = Document(path)
    os.makedirs(img_dir, exist_ok=True)
    images = []
    for rel in doc.part.rels.values():
        if 'image' in rel.reltype and not rel.is_external:
            blob = rel.target_part.blob
            if len(blob) < 2048: continue  # 过小的多为分隔线/图标
            ext = os.path.splitext(str(rel.target_part.partname))[1] or '.png'
            fn = '标书图_' + hashlib.md5(blob).hexdigest()[:10] + ext
            fp = os.path.join(img_dir, fn)
            if not os.path.exists(fp): open(fp, 'wb').write(blob)
            images.append(fn)
    out = []
    for child in doc.element.body.iterchildren():
        if child.tag == qn('w:p'):
            p = Paragraph(child, doc)
            t = p.text.strip()
            if not t: continue
            style = (p.style.name or '').lower()
            if 'heading 1' in style or style == '标题 1': out.append('# ' + t)
            elif 'heading 2' in style or style == '标题 2': out.append('## ' + t)
            elif 'heading' in style or style.startswith('标题'): out.append('### ' + t)
            else: out.append(t)
        elif child.tag == qn('w:tbl'):
            tb = Table(child, doc)
            rows = ['| ' + ' | '.join(' '.join(c.text.split()) for c in r.cells) + ' |' for r in tb.rows]
            if rows:
                rows.insert(1, '|' + '---|' * len(tb.rows[0].cells))
                out.append('\n'.join(rows))
    return split_md_sections('\n\n'.join(out)), images

# ---------- 图片 AI 打标(调用已配的视觉模型:OCR 读图 → 分类/图注/落位锚点) ----------
CATS = ['架构图', '功能截图', '资质证书', '案例证明', '人员证书', '其他']
VISION_PROMPT = (
    '这是投标文件素材库里的一张图片。请仔细看图并 OCR 读出图内文字,然后只输出一个 JSON(不要代码块、不要解释):\n'
    '{"category":"从 架构图/功能截图/资质证书/案例证明/人员证书/其他 里选一个",'
    '"id":"用 类别-业务名 命名,如 资质-ISO9001、功能截图-代码扫描、架构-总体架构,只用中文数字英文和连字符",'
    '"caption":"正式标书口径的图注,如 ISO9001质量管理体系认证证书",'
    '"ocr":"图内关键文字摘要,60字以内;看不清写 待确认",'
    '"keywords":"适用场景关键词,逗号分隔",'
    '"anchor":"落位锚点=这张图只允许插到标书哪类位置,如 总体架构章·概述段后 / 资质证明章 / 逐条应答证明材料列"}')
VISION = {'running': False, 'done': 0, 'total': 0, 'updated': 0, 'errors': [], 'ts': ''}

def _vision_provider():
    conf = read_json(conf_path(), {'providers': [], 'routing': {}})
    ps = conf.get('providers') or []
    if not ps: return None, '还没有配置模型接入点'
    pid = (conf.get('routing') or {}).get('default')
    p = next((x for x in ps if x.get('id') == pid), ps[-1])
    vm = p.get('vision_model') or ''
    if not vm:
        m = (p.get('model') or '').lower()
        vm = p.get('model') if ('vl' in m or 'vision' in m or '-v' in m) else ''
    if not vm: return None, '当前接入点没有指定视觉模型:在「模型接入」的视觉模型一栏填一个多模态模型(如 senseaudio-vl-1.0-260319)'
    return {**p, 'vision_model': vm}, ''

def tag_one_image(path, p):
    import base64
    raw = open(path, 'rb').read()
    if len(raw) > 8 * 1024 * 1024: raise RuntimeError('图片过大(>8MB),已跳过')
    mime = 'image/png' if path.lower().endswith('.png') else 'image/jpeg'
    payload = {'model': p['vision_model'], 'max_tokens': 500, 'messages': [{'role': 'user', 'content': [
        {'type': 'text', 'text': VISION_PROMPT},
        {'type': 'image_url', 'image_url': {'url': 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode())}}]}]}
    resp = _openai_req(p.get('base_url'), p.get('api_key'), '/chat/completions', payload,
                       timeout=120, verify=p.get('verify_ssl', True))
    txt = ((resp.get('choices') or [{}])[0].get('message') or {}).get('content', '') or ''
    txt = txt.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    i, j = txt.find('{'), txt.rfind('}')
    d = json.loads(txt[i:j + 1])
    if d.get('category') not in CATS: d['category'] = '其他'
    return d

def write_image_index(entries):
    """写 图片索引.md(技能包按这张表自动配图)+ 同名 json 便于增量更新"""
    d = assets_dir()
    write_json(os.path.join(d, '图片索引.json'), entries)
    rows = ['| 图片ID | 文件 | 默认图注 | 类别 | 图内文字摘要 | 适用场景/关键词 | 落位锚点 |',
            '|---|---|---|---|---|---|---|']
    cell = lambda s: str(s or '').replace('|', '/').replace('\n', ' ')[:120]
    for e in entries:
        rows.append('| %s | %s | %s | %s | %s | %s | %s |' % (cell(e.get('id')), cell(e.get('file')),
                    cell(e.get('caption')), cell(e.get('category')), cell(e.get('ocr')),
                    cell(e.get('keywords')), cell(e.get('anchor'))))
    open(os.path.join(d, '图片索引.md'), 'w', encoding='utf-8').write('\n'.join(rows) + '\n')

def vision_worker(force):
    d = assets_dir(); img_dir = os.path.join(d, '图片')
    entries = read_json(os.path.join(d, '图片索引.json'), [])
    done_files = {e.get('file') for e in entries if e.get('id') and not str(e.get('id')).startswith('标书图')}
    p, err = _vision_provider()
    try:
        if err: VISION['errors'] = [err]; return
        files = [f for f in sorted(os.listdir(img_dir)) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and not f.startswith('.')] if os.path.isdir(img_dir) else []
        todo = files if force else [f for f in files if f not in done_files]
        VISION.update(total=len(todo), done=0, updated=0, errors=[])
        used = {e.get('id') for e in entries}
        for fn in todo:
            fp = os.path.join(img_dir, fn)
            try:
                info = tag_one_image(fp, p)
                safe = ''.join(c for c in str(info.get('id') or '')[:40] if c not in '\\/:*?"<>|').strip() or (info['category'] + '-未命名')
                base, n = safe, 2
                while safe in used: safe = '%s-%d' % (base, n); n += 1
                used.add(safe)
                ext = os.path.splitext(fn)[1]
                newfn = safe + ext
                if newfn != fn and not os.path.exists(os.path.join(img_dir, newfn)):
                    os.rename(fp, os.path.join(img_dir, newfn))
                else:
                    newfn = fn
                entries = [e for e in entries if e.get('file') not in (fn, newfn)]
                entries.append({'id': safe, 'file': newfn, 'caption': info.get('caption', ''), 'category': info.get('category', '其他'),
                                'ocr': info.get('ocr', ''), 'keywords': info.get('keywords', ''), 'anchor': info.get('anchor', '')})
                VISION['updated'] += 1
                write_image_index(entries)      # 每张即时落盘,中断也不丢
            except Exception as e:
                VISION['errors'] = (VISION['errors'] + ['%s:%s' % (fn, str(e)[:80])])[-5:]
            VISION['done'] += 1
    finally:
        VISION['running'] = False; VISION['ts'] = now()

@app.post('/v1/assets/vision_index')
def start_vision(force: bool = False):
    if VISION['running']: return {'ok': True, 'already': True, **VISION}
    p, err = _vision_provider()
    if err: return JSONResponse({'ok': False, 'error': err}, 400)
    VISION.update(running=True, done=0, total=0, updated=0, errors=[])
    threading.Thread(target=vision_worker, args=(force,), daemon=True).start()
    return {'ok': True, 'model': p['vision_model']}

@app.get('/v1/assets/vision_index')
def vision_status(): return VISION

@app.post('/v1/assets/open')
def open_assets():
    """在系统文件管理器里打开素材库目录(仅本地模式;云端多租户禁用)"""
    if MULTIUSER: return JSONResponse({'ok': False, 'error': '云端模式不支持'}, 403)
    d = assets_dir()
    try:
        if sys.platform == 'darwin': subprocess.Popen(['open', d])
        elif os.name == 'nt': os.startfile(d)  # noqa
        else: subprocess.Popen(['xdg-open', d])
        return {'ok': True, 'folder': d}
    except Exception as e:
        return {'ok': False, 'error': str(e), 'folder': d}

@app.delete('/v1/assets')
def clear_assets(scope: str = 'ingested'):
    """清空入库产物(章节模板/图片/原始标书/索引/流水);scope=all 时连规范素材一起清"""
    d = assets_dir(); removed = 0
    targets = ['章节模板', '图片', '原始标书']
    files = ['图片索引.md', '入库流水.jsonl']
    if scope == 'all': files += ['公司介绍.md', '产品资料.md', '资质与案例.md', '应答要点.md']
    for t in targets:
        p = os.path.join(d, t)
        if os.path.isdir(p): removed += sum(len(f) for _, _, f in os.walk(p)); shutil.rmtree(p, ignore_errors=True)
    for f in files:
        p = os.path.join(d, f)
        if os.path.isfile(p): os.remove(p); removed += 1
    return {'ok': True, 'removed': removed}

@app.post('/v1/assets/ingest')
async def ingest_asset(file: UploadFile = File(...)):
    """上传过往标书(docx/md/txt)→ 图片入 图片/、章节拆分归类入 章节模板/<分类>/、缺失的规范素材自动生成"""
    fn = os.path.basename(file.filename or '过往标书.docx')
    stem, ext = os.path.splitext(fn); ext = ext.lower()
    raw_dir = os.path.join(assets_dir(), '原始标书'); os.makedirs(raw_dir, exist_ok=True)
    blob = await file.read()
    digest = hashlib.md5(blob).hexdigest()
    # 同一份文件重复上传直接跳过(否则章节模板会成倍堆积)
    log_path = os.path.join(assets_dir(), '入库流水.jsonl')
    if os.path.isfile(log_path):
        for ln in open(log_path, encoding='utf-8').read().splitlines():
            try: rec = json.loads(ln)
            except Exception: continue
            if rec.get('md5') == digest:
                return {'ok': True, 'skipped': True, 'source': fn, 'sections': 0, 'images': 0, 'categories': {},
                        'folder': assets_dir(), 'note': '这份文件之前已入库(%s),本次跳过,未重复生成' % rec.get('ts', '')}
    src = os.path.join(raw_dir, fn)
    open(src, 'wb').write(blob)
    img_dir = os.path.join(assets_dir(), '图片')
    sections, images = [], []
    if ext == '.docx':
        try:
            sections, images = docx_to_sections_and_images(src, img_dir)
        except ImportError:
            return JSONResponse({'ok': False, 'error': '解析 docx 需要 python-docx(内置引擎版已自带;源码运行请 pip install python-docx)'}, 501)
        except Exception as e:
            return JSONResponse({'ok': False, 'error': 'docx 解析失败:%s' % e}, 400)
    elif ext in ('.md', '.txt'):
        sections = split_md_sections(open(src, encoding='utf-8', errors='ignore').read())
    else:
        return JSONResponse({'ok': False, 'error': '暂支持 .docx/.md/.txt(PDF 请先另存为 Word)'}, 400)
    stamp = datetime.datetime.now().strftime('%m%d')
    safe = lambda s: (''.join(c for c in s if c not in '\\/:*?"<>|').strip() or '未命名')[:40]
    created, cats, canon_new = [], {}, {}
    for title, content in sections:
        cat = classify(title)
        cats[cat] = cats.get(cat, 0) + 1
        d = os.path.join(assets_dir(), '章节模板', cat); os.makedirs(d, exist_ok=True)
        p = os.path.join(d, '%s_%s_%s.md' % (safe(title), safe(stem)[:20], stamp))
        open(p, 'w', encoding='utf-8').write('> 来源:%s · 入库 %s · 整章可复用,引用前请核对时效与项目名\n\n%s\n' % (fn, now(), content))
        created.append(os.path.relpath(p, assets_dir()))
        canon = {'公司介绍': '公司介绍.md', '产品资料': '产品资料.md', '资质与案例': '资质与案例.md'}.get(cat)
        if canon: canon_new.setdefault(canon, []).append(content)
    for canon, parts in canon_new.items():
        cp = os.path.join(assets_dir(), canon)
        if not os.path.exists(cp):  # 已有的规范素材绝不覆盖,只补缺
            open(cp, 'w', encoding='utf-8').write('\n\n'.join(parts) + '\n')
            created.append(canon)
    if images:
        # 先登记占位行(未识别),随后由「AI 识图打标」补全类别/图注/OCR/落位锚点
        entries = read_json(os.path.join(assets_dir(), '图片索引.json'), [])
        have = {e.get('file') for e in entries}
        for f in images:
            if f not in have:
                entries.append({'id': os.path.splitext(f)[0], 'file': f, 'caption': '〔待AI识图〕', 'category': '未识别',
                                'ocr': '', 'keywords': '来自 %s' % stem, 'anchor': ''})
        write_image_index(entries)
    rec = {'ts': now(), 'source': fn, 'md5': digest, 'sections': len(sections), 'images': len(images), 'categories': cats}
    open(log_path, 'a', encoding='utf-8').write(json.dumps(rec, ensure_ascii=False) + '\n')
    return {'ok': True, **rec, 'created': created[:50], 'folder': assets_dir(), 'engine': 'local-parser'}

@app.post('/v1/transcribe')
def transcribe():
    return JSONResponse({'error': '本机未装转写模型;接 whisper.cpp sidecar 或云端转写'}, 501)

@app.get('/v1/health')
def health():
    return {'ok': True, 'data_dir': DATA, 'agent': bool(config_agent_cmd()),
            'version': ENGINE_VERSION, 'author': AUTHOR, 'features': ENGINE_FEATURES}

def migrate_conf():
    """存量配置迁移:界面撤下 opencode 选项后,存过 kind=opencode 的用户会遇到空白下拉+裸值摘要。
    opencode 与 s2 本就共用 Key/网关/模型字段 → 直接归并到 s2;未知 kind 一律落安全值。"""
    cp = os.path.join(DATA, 'config.json')
    conf = read_json(cp, None)
    if not conf: return
    eng = conf.get('engine') or {}
    kind = eng.get('kind')
    known = ('mock', 's2', 'sowork', 'claude', 'codex', 'custom')
    if kind == 'opencode':
        eng['kind'] = 's2'
    elif kind and kind not in known:
        eng['kind'] = 's2' if (eng.get('s2_key') or '').strip() else 'mock'
    else:
        return
    conf['engine'] = eng
    write_json(cp, conf)

ensure_preset()   # 预置配置种子(定制发包用),必须在任何请求处理前完成
migrate_conf()    # 存量引擎配置归并(撤下的选项不能把老用户晾在空白下拉上)

web = os.environ.get('BID_WEB_DIR') or os.path.join(HERE, '..', 'app', 'src')
if os.path.isdir(web): app.mount('/', StaticFiles(directory=web, html=True), name='web')

if __name__ == '__main__':
    import uvicorn
    # 云端容器需监听 0.0.0.0;桌面/本机默认只听回环,不对外暴露
    host = os.environ.get('HOST') or ('0.0.0.0' if MULTIUSER else '127.0.0.1')
    _port = int(os.environ.get('PORT', 8080))
    print('[中标狗] 引擎 v%s 启动:http://127.0.0.1:%d  数据目录:%s' % (ENGINE_VERSION, _port, DATA), flush=True)
    # access_log 关掉:SSE 每秒一次轮询把日志刷成瀑布,网页端长跑时 IO 白白吃 CPU
    uvicorn.run(app, host=host, port=_port, access_log=os.environ.get('BID_ACCESS_LOG') == '1',
                log_level='warning', timeout_keep_alive=65)
