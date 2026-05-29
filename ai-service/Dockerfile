# Stage 1: Install dependencies
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime with pre-downloaded models
FROM python:3.12-slim
WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY app/ ./app/

# Pre-download ML models at build time (NOT runtime) so container starts fast and works offline
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
RUN python -m spacy download en_core_web_sm
RUN python -c "import nltk; nltk.download('punkt_tab', quiet=True); nltk.download('punkt', quiet=True)"

# Run as non-root
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
