FROM eclipse-temurin:21-jre-jammy@sha256:f04fb34e053148344e83317976114ec3f37e4b830ec8bdab5a2fe3cecd7d010b AS java-runtime

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:${PATH}

FROM base AS pmd-download
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip \
    && rm -rf /var/lib/apt/lists/*
# SHA256 published on the official PMD 7.17.0 GitHub release assets page.
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -f /run/secrets/build_ca ]; then export CURL_CA_BUNDLE=/run/secrets/build_ca; fi \
    && curl --fail --location --silent --show-error --retry 3 \
      --connect-timeout 20 --max-time 300 \
      'https://github.com/pmd/pmd/releases/download/pmd_releases%2F7.17.0/pmd-dist-7.17.0-bin.zip' \
      --output /tmp/pmd.zip \
    && printf '%s  %s\n' '440f6855769c1a651cebd735133cba188df077881af31bd923766b869482bebd' /tmp/pmd.zip | sha256sum --check --strict \
    && unzip -q /tmp/pmd.zip -d /opt \
    && mv /opt/pmd-bin-7.17.0 /opt/pmd \
    && chmod -R a+rX /opt/pmd \
    && chmod a+x /opt/pmd/bin/pmd \
    && rm /tmp/pmd.zip

FROM base AS tools
COPY --from=pmd-download /opt/pmd /opt/pmd
ENV REVIEW_ANALYSIS_PMD_BIN=/opt/pmd/bin/pmd
RUN java -version && /opt/pmd/bin/pmd --version

FROM tools AS app-build
WORKDIR /opt/review-analysis
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -f /run/secrets/build_ca ]; then export npm_config_cafile=/run/secrets/build_ca; fi \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ ./src/
COPY app/ ./app/
COPY ui/ ./ui/
COPY fixtures/ ./fixtures/
RUN npm run build

FROM tools AS runtime
LABEL org.opencontainers.image.title="Review Analysis" \
      org.opencontainers.image.version="0.2.0" \
      org.opencontainers.image.description="Local advisory source review with trusted static analyzers"
WORKDIR /opt/review-analysis
COPY --from=app-build --chown=node:node /opt/review-analysis/ ./
RUN mkdir /inputs && chmod a+rx /inputs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
