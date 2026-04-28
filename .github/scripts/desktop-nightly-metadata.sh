#!/usr/bin/env bash
set -euo pipefail

tag_pattern="${TAG_PATTERN:-desktop-nightly-*}"
project_file="${PROJECT_FILE:-apps/desktop/Versioneer.xcodeproj/project.pbxproj}"
desktop_path="${DESKTOP_PATH:-apps/desktop}"
downloads_host="${DOWNLOADS_HOST:-https://dl.versioneer.app}"

marketing_version="$(
  grep -m1 'MARKETING_VERSION = ' "$project_file" | sed -E 's/.*MARKETING_VERSION = ([^;]+);/\1/'
)"

if [ -z "$marketing_version" ]; then
  echo "Could not determine MARKETING_VERSION from $project_file" >&2
  exit 1
fi

previous_tag="$(git tag -l "$tag_pattern" --sort=-creatordate | head -n 1 || true)"
compare_range=""
should_publish="true"

if [ -n "$previous_tag" ]; then
  compare_range="${previous_tag}..HEAD"
  if git diff --quiet "$compare_range" -- "$desktop_path"; then
    should_publish="false"
  fi
fi

short_sha="$(git rev-parse --short=12 HEAD)"
date_stamp="$(date -u +%Y%m%d)"
build_number="${GITHUB_RUN_NUMBER:-$(git rev-list --count HEAD)}"
tag_name="desktop-nightly-${date_stamp}-${short_sha}"
release_title="Versioneer Desktop Nightly ${date_stamp}"
archive_stem="Versioneer-nightly-${date_stamp}-${short_sha}"
download_url="${downloads_host}/nightly/downloads/${archive_stem}.zip"
appcast_url="${downloads_host}/nightly/appcast.xml"
latest_url="${downloads_host}/nightly/latest/Versioneer.zip"

emit_output() {
  local key="$1"
  local value="$2"

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$key" "$value"
  fi
}

emit_output "should_publish" "$should_publish"
emit_output "previous_tag" "$previous_tag"
emit_output "compare_range" "$compare_range"
emit_output "marketing_version" "$marketing_version"
emit_output "build_number" "$build_number"
emit_output "tag_name" "$tag_name"
emit_output "release_title" "$release_title"
emit_output "archive_stem" "$archive_stem"
emit_output "short_sha" "$short_sha"
emit_output "download_url" "$download_url"
emit_output "appcast_url" "$appcast_url"
emit_output "latest_url" "$latest_url"
