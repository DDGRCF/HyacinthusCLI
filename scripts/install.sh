#!/usr/bin/env bash
set -euo pipefail

repo="${HYACINTHUS_CLI_REPO:-DDGRCF/HyacinthusCLI}"
version="${HYACINTHUS_CLI_VERSION:-latest}"
install_dir="${HYACINTHUS_CLI_INSTALL_DIR:-${HOME}/.local/bin}"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}:${arch}" in
    Linux:x86_64) echo "x86_64-unknown-linux-gnu" ;;
    Linux:aarch64|Linux:arm64) echo "aarch64-unknown-linux-gnu" ;;
    Darwin:x86_64) echo "x86_64-apple-darwin" ;;
    Darwin:arm64) echo "aarch64-apple-darwin" ;;
    *)
      echo "unsupported platform: ${os}/${arch}" >&2
      exit 2
      ;;
  esac
}

target="${HYACINTHUS_CLI_TARGET:-$(detect_target)}"
base_url="https://github.com/${repo}/releases"
if [[ "${version}" == "latest" ]]; then
  asset_url="${base_url}/latest/download/hyacinthus-cli-${target}.tar.gz"
  checksum_url="${asset_url}.sha256"
else
  asset_url="${base_url}/download/${version}/hyacinthus-cli-${version#v}-${target}.tar.gz"
  checksum_url="${asset_url}.sha256"
fi

curl -fsSL "${asset_url}" -o "${tmp_dir}/hyacinthus.tar.gz"
curl -fsSL "${checksum_url}" -o "${tmp_dir}/hyacinthus.tar.gz.sha256"
(
  cd "${tmp_dir}"
  sha256sum -c hyacinthus.tar.gz.sha256
  tar -xzf hyacinthus.tar.gz
)

binary="$(find "${tmp_dir}" -type f -name hyacinthus -perm -111 | head -n 1)"
if [[ -z "${binary}" ]]; then
  echo "hyacinthus binary not found in archive" >&2
  exit 1
fi

mkdir -p "${install_dir}"
install -m 0755 "${binary}" "${install_dir}/hyacinthus"
"${install_dir}/hyacinthus" --version
