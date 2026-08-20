#!/bin/bash
# 中标狗 · Mac 一键启动(双击本文件即可)
cd "$(dirname "$0")" || exit 1
clear
echo "==============================================="
echo "         中标狗 · 本地启动"
echo "==============================================="
echo

# 1) 检查 python3
if ! command -v python3 >/dev/null 2>&1; then
  echo "缺少 python3。请在弹出的窗口点「安装」后,重新双击本文件。"
  echo "(若没有弹窗,请手动执行:xcode-select --install)"
  xcode-select --install 2>/dev/null
  echo; read -r -p "按回车键关闭…" _; exit 1
fi
echo "[1/4] python3 已就绪:$(python3 --version 2>&1)"

# 2) 首次运行装依赖(装在本文件夹的 .venv 里,不污染系统)
VENV=".venv"
DEPS="fastapi uvicorn python-multipart python-docx pypdf certifi"
MIRROR="-i https://pypi.tuna.tsinghua.edu.cn/simple"
if [ ! -x "$VENV/bin/python" ]; then
  echo "[2/4] 首次运行,正在准备运行环境(约 1~3 分钟,请勿关闭窗口)…"
  python3 -m venv "$VENV" || { echo "创建环境失败"; read -r -p "按回车键关闭…" _; exit 1; }
  # 国内网络清华源快一个数量级:先走镜像(20 秒超时防死源),不行再回官方源
  "$VENV/bin/python" -m pip install --quiet --timeout 20 --retries 2 $MIRROR --upgrade pip 2>/dev/null \
    || "$VENV/bin/python" -m pip install --quiet --upgrade pip
else
  echo "[2/4] 运行环境已就绪"
fi
if ! "$VENV/bin/python" -c "import fastapi,uvicorn,multipart,docx,pypdf,certifi" >/dev/null 2>&1; then
  echo "      正在补齐或更新运行依赖…"
  if ! "$VENV/bin/python" -m pip install --quiet --timeout 20 --retries 2 $MIRROR $DEPS; then
    echo "      镜像源不可用,改用官方源重试…"
    "$VENV/bin/python" -m pip install --quiet --timeout 60 --retries 2 $DEPS \
      || { echo "依赖安装失败,请检查网络"; read -r -p "按回车键关闭…" _; exit 1; }
  fi
fi

# 3) 选一个没被占用的端口
PORT=""
for p in 8848 8080 8090 8099; do
  if ! (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then PORT=$p; break; fi
done
[ -z "$PORT" ] && { echo "8848/8080/8090/8099 都被占用,请关掉占用程序后重试"; read -r -p "按回车键关闭…" _; exit 1; }
echo "[3/4] 使用端口 $PORT"

# 4) 启动引擎并打开浏览器
echo "[4/4] 启动中…"
PORT=$PORT BID_WEB_DIR="$(pwd)/app/src" "$VENV/bin/python" server/engine_v1.py &
ENGINE_PID=$!
trap 'kill $ENGINE_PID 2>/dev/null' EXIT

for _ in $(seq 1 30); do
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo
echo "==============================================="
echo "  已启动!浏览器地址: http://127.0.0.1:$PORT"
echo "  文件保存在:~/Documents/中标狗/"
echo "  关闭本窗口 = 停止服务"
echo "==============================================="
open "http://127.0.0.1:$PORT" 2>/dev/null
wait $ENGINE_PID
