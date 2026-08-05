@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 中标狗 · 本地启动
echo ===============================================
echo          中标狗 · 本地启动
echo ===============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo 缺少 Python。请先到 https://www.python.org/downloads/ 下载安装,
  echo 安装时务必勾选 "Add Python to PATH",然后重新双击本文件。
  pause
  exit /b 1
)
echo [1/4] Python 已就绪
for /f "delims=" %%v in ('python --version 2^>^&1') do echo       %%v

if not exist ".venv\Scripts\python.exe" (
  echo [2/4] 首次运行,正在准备运行环境(约 1~3 分钟,请勿关闭窗口)...
  python -m venv .venv || (echo 创建环境失败 & pause & exit /b 1)
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet fastapi uvicorn python-multipart python-docx certifi
  if errorlevel 1 (
    echo       默认源较慢,改用国内镜像重试...
    .venv\Scripts\python -m pip install --quiet -i https://pypi.tuna.tsinghua.edu.cn/simple fastapi uvicorn python-multipart python-docx certifi || (echo 依赖安装失败,请检查网络 & pause & exit /b 1)
  )
) else (
  echo [2/4] 运行环境已就绪
)

set PORT=8848
netstat -ano | findstr ":8848 " >nul 2>&1 && set PORT=8080
echo [3/4] 使用端口 %PORT%

echo [4/4] 启动中...
set BID_WEB_DIR=%cd%\app\src
start "" http://127.0.0.1:%PORT%
echo.
echo ===============================================
echo   已启动!浏览器地址: http://127.0.0.1:%PORT%
echo   文件保存在:%USERPROFILE%\Documents\中标狗\
echo   关闭本窗口 = 停止服务
echo ===============================================
.venv\Scripts\python server\engine_v1.py
pause
