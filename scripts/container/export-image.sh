#!/usr/bin/env bash
set -euo pipefail
if (( $# > 1 )); then
  printf 'Usage: %s [output.tar.gz]\n' "$0" >&2
  exit 2
fi
image_archive="${1:-review-analysis-image.tar.gz}"
archive_directory="$(cd -- "$(dirname -- "$image_archive")" && pwd)"
archive_name="$(basename -- "$image_archive")"
archive_path="$archive_directory/$archive_name"
image_id="$(docker image inspect review-analysis:0.2.0 --format '{{.Id}}')"
temporary_archive="$(mktemp "$archive_directory/.review-analysis-image.XXXXXX")"
trap 'rm -f -- "$temporary_archive"' EXIT
docker save review-analysis:0.2.0 | gzip -n >"$temporary_archive"
mv -f -- "$temporary_archive" "$archive_path"
printf '%s\n' "$image_id" >"$archive_path.image-id"
(cd -- "$archive_directory" && sha256sum -- "$archive_name" >"$archive_name.sha256")
printf 'Exported %s\nImage: %s\n' "$archive_path" "$image_id"
