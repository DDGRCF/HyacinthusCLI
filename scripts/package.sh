#!/usr/bin/env bash
set -euo pipefail

target="${1:?usage: scripts/package.sh <target-triple> [profile]}"
profile="${2:-release}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(grep -m1 '^version = ' "${root}/Cargo.toml" | sed -E 's/version = "([^"]+)"/\1/')"
archive_name="hyacinthus-cli-${version}-${target}"
dist_dir="${root}/dist"
work_dir="${dist_dir}/${archive_name}"
binary="${root}/target/${target}/${profile}/hyacinthus"

if [[ ! -x "${binary}" ]]; then
  echo "binary not found: ${binary}" >&2
  echo "run: cargo build --locked --${profile} --target ${target}" >&2
  exit 1
fi

rm -rf "${work_dir}"
mkdir -p "${work_dir}"
cp "${binary}" "${work_dir}/hyacinthus"
cp "${root}/README.md" "${work_dir}/README.md"
cp "${root}/Cargo.lock" "${work_dir}/Cargo.lock"
cp -R "${root}/skills" "${work_dir}/skills"
cp -R "${root}/assets" "${work_dir}/assets"

(
  cd "${dist_dir}"
  tar -czf "${archive_name}.tar.gz" "${archive_name}"
  sha256sum "${archive_name}.tar.gz" > "${archive_name}.tar.gz.sha256"
  cp "${archive_name}.tar.gz" "hyacinthus-cli-${target}.tar.gz"
  sha256sum "hyacinthus-cli-${target}.tar.gz" > "hyacinthus-cli-${target}.tar.gz.sha256"
)

echo "${dist_dir}/${archive_name}.tar.gz"
