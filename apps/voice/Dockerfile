# syntax=docker/dockerfile:1
# HomeyDash voice service: speech-to-text (faster-whisper), command matching, optional Needle. CPU only.
# Build from the repo root:  docker build -f apps/voice/Dockerfile -t homey-voice apps/voice
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
# needle is an extra; the model extra (torch, FunctionGemma) is left out on purpose: ~2 GB and needs a gated licence
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project --extra needle

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY *.py fetch_assets.sh ./
COPY static ./static
# wake word models + onnxruntime-web are fetched at build time, so the container never needs a CDN
RUN rm -rf static/_test && chmod +x fetch_assets.sh && ./fetch_assets.sh && apt-get purge -y nodejs npm && apt-get autoremove -y
ENV PATH="/app/.venv/bin:$PATH" \
    HF_HOME=/models/hf \
    XDG_CACHE_HOME=/models/cache \
    CACTUS_TELEMETRY=0 \
    PYTHONUNBUFFERED=1
RUN useradd -u 1654 -m homeyvoice && mkdir -p /models && chown homeyvoice /models
USER homeyvoice
VOLUME /models
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://localhost:8765/api/catalog || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
