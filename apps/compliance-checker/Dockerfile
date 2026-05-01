FROM python:3.12-slim AS builder

WORKDIR /app
RUN pip install --no-cache-dir uv

COPY pyproject.toml .python-version ./
RUN uv sync --no-dev --no-editable

COPY src ./src
RUN uv sync --no-dev


FROM python:3.12-slim AS runtime

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY src ./src
COPY rules ./rules

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8090

CMD ["python", "-m", "compliance_checker"]
