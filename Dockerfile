FROM node:22-bookworm-slim AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.27-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY internal ./internal
COPY --from=frontend /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pakkelapp .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 pakkelapp \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin pakkelapp \
    && mkdir /data && chown 10001:10001 /data
COPY --from=backend /out/pakkelapp /usr/local/bin/pakkelapp
ENV JUL_ADDR=0.0.0.0:8080 JUL_DATA_DIR=/data TZ=Europe/Oslo
USER 10001:10001
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/usr/local/bin/pakkelapp", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/pakkelapp"]
