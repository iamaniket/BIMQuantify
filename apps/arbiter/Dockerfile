FROM python:3.12-slim AS builder

WORKDIR /app
RUN pip install --no-cache-dir uv

# Copy the lockfile too and resolve with --frozen (CC8-LOCK-1): the image must
# install the exact, CI-tested dependency set, not re-resolve fresh at build time.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-editable

COPY src ./src
RUN uv sync --frozen --no-dev


FROM python:3.12-slim AS runtime

# Non-root runtime user (SEAM-DOCKER-ROOT-2 / CIS Docker 4.1).
RUN useradd --system --uid 10001 --create-home arbiter
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY src ./src
COPY rules ./rules
RUN chown -R arbiter:arbiter /app

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8090
USER arbiter

CMD ["python", "-m", "arbiter"]
