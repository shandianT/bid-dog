FROM python:3.12-slim

# 出 Word 需要中文字体;fonts-arphic 提供楷体/明体,noto-cjk 提供常用中文字形
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-noto-cjk fonts-arphic-uming fonts-arphic-ukai \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn python-multipart python-docx certifi

COPY server/ /app/server/
COPY app/src/ /app/web/

ENV BID_HOME=/data \
    BID_WEB_DIR=/app/web \
    BID_MULTIUSER=1 \
    PORT=8080
VOLUME ["/data"]
EXPOSE 8080

# BID_PASSWORD 必须在运行时通过环境变量传入(公网部署没有口令=谁都能上传/下载标书)
CMD ["python", "server/engine_v1.py"]
