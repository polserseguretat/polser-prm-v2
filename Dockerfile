# =====================================================================
# PRM POLSER — Dockerfile per PocketBase 0.40.3
# Multi-stage: descàrrega el binary oficial i copia configs
# =====================================================================
FROM alpine:3.19 AS downloader

ARG PB_VERSION=0.40.3
ARG PB_ARCH=amd64

WORKDIR /tmp

RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
    && unzip -o "pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
    && chmod +x pocketbase

# =====================================================================
FROM alpine:3.19
# Dependències per healthcheck i entrada/sortida
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    wget \
    bash \
    openssl

# Copiem el binary
COPY --from=downloader /tmp/pocketbase /usr/local/bin/pocketbase

# Estructura de directoris
RUN mkdir -p /pb/pb_data /pb/pb_hooks /pb/pb_migrations /pb/pb_public

# Ports
EXPOSE 8090

# El directori de treball és /pb perquè PocketBase hi resol pb_data/ pb_hooks/
WORKDIR /pb

# PocketBase aplica migracions automàticament en arrencada.
# Els hooks es carreguen des de pb_hooks/.
ENTRYPOINT ["pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090"]
