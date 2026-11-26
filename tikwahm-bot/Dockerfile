FROM python:3.12-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=10000

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY bot.py ./bot.py
COPY tikwahm_loading.gif ./tikwahm_loading.gif

EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn bot:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
