#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
docker info >/dev/null
build_arguments=(--platform linux/amd64 --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY)
if [[ -n "${REVIEW_ANALYSIS_BUILD_CA_FILE:-}" ]]; then
  build_arguments+=(--secret "id=build_ca,src=$REVIEW_ANALYSIS_BUILD_CA_FILE")
fi
docker build "${build_arguments[@]}" --tag review-analysis:0.2.0 "$project_root"
docker image inspect review-analysis:0.2.0 --format '{{.Id}}'
