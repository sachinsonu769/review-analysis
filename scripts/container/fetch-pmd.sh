#!/usr/bin/env bash
set -euo pipefail
if (( $# > 1 )); then
  printf 'Usage: %s [output.zip]\n' "$0" >&2
  exit 2
fi
pmd_archive="${1:-/tmp/review-analysis-pmd-7.17.0-bin.zip}"
archive_directory="$(cd -- "$(dirname -- "$pmd_archive")" && pwd)"
archive_path="$archive_directory/$(basename -- "$pmd_archive")"
temporary_archive="$(mktemp "$archive_directory/.review-analysis-pmd.XXXXXX")"
trap 'rm -f -- "$temporary_archive"' EXIT
curl --fail --location --silent --show-error --retry 3 \
  --connect-timeout 20 --max-time 300 \
  'https://github.com/pmd/pmd/releases/download/pmd_releases%2F7.17.0/pmd-dist-7.17.0-bin.zip' \
  --output "$temporary_archive"
printf '%s  %s\n' '440f6855769c1a651cebd735133cba188df077881af31bd923766b869482bebd' "$temporary_archive" | sha256sum --check --strict
mv -f -- "$temporary_archive" "$archive_path"
printf 'Verified official PMD 7.17.0: %s\n' "$archive_path"
