FROM python:3.12-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

# Install deps as root
RUN pip install --no-cache-dir fastmcp pyyaml

COPY server/ ./server/
COPY pyproject.toml .

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

EXPOSE 8000 8001

USER app
ENTRYPOINT ["python", "-m", "server.mcp_server"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')" || exit 1
