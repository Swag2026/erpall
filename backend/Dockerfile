FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Railway (and most PaaS) inject the port as $PORT; falls back to 8000 locally / on the VM.
# ONE worker on purpose: online-presence, typing and call-signaling state live in memory (see app/core/tenant.py).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
