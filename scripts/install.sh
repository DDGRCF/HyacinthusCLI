#!/usr/bin/env bash
# 改动说明：校验 CLI 下载后自动向已存在的 Agent 目录安装并核对完整 Skills，支持显式目录和跳过。
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
archive_file="$(basename "${asset_url}")"
checksum_file="${archive_file}.sha256"

verify_sha256() {
  local file="$1"
  local checksum="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${checksum}"
    return
  fi
  local expected actual
  expected="$(awk '{print $1}' "${checksum}")"
  actual="$(shasum -a 256 "${file}" | awk '{print $1}')"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "${file}: FAILED" >&2
    echo "sha256 mismatch: expected ${expected}, got ${actual}" >&2
    exit 1
  fi
  echo "${file}: OK"
}

curl -fsSL "${asset_url}" -o "${tmp_dir}/${archive_file}"
curl -fsSL "${checksum_url}" -o "${tmp_dir}/${checksum_file}"
(
  cd "${tmp_dir}"
  verify_sha256 "${archive_file}" "${checksum_file}"
  tar -xzf "${archive_file}"
)

binary="$(find "${tmp_dir}" -type f -name hyacinthus -perm -111 | head -n 1)"
if [[ -z "${binary}" ]]; then
  echo "hyacinthus binary not found in archive" >&2
  exit 1
fi

mkdir -p "${install_dir}"
install -m 0755 "${binary}" "${install_dir}/hyacinthus"
"${install_dir}/hyacinthus" --version

# Export and validate the binary-owned Skill tree before reporting installation success.
install_skills() {
  local destination="$1" checked
  "${install_dir}/hyacinthus" --no-notice skills export --dir "${destination}"
  checked="$("${install_dir}/hyacinthus" --no-notice --jq .data.ok skills check --dir "${destination}")"
  if [[ "${checked}" != "true" ]]; then
    echo "Skills verification failed: ${destination}" >&2
    return 1
  fi
}

if [[ "${HYACINTHUS_CLI_SKIP_SKILLS:-0}" == "1" ]]; then
  if [[ -n "${HYACINTHUS_CLI_SKILLS_DIR:-}" ]]; then
    echo "HYACINTHUS_CLI_SKIP_SKILLS and HYACINTHUS_CLI_SKILLS_DIR cannot be combined" >&2
    exit 2
  fi
elif [[ -n "${HYACINTHUS_CLI_SKILLS_DIR:-}" ]]; then
  install_skills "${HYACINTHUS_CLI_SKILLS_DIR}"
else
  skill_homes=("${HERMES_HOME:-${HOME}/.hermes}" "${CODEX_HOME:-${HOME}/.codex}" "${CLAUDE_HOME:-${HOME}/.claude}" "${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}")
  installed_homes=()
  for agent_home in "${skill_homes[@]}"; do
    [[ -d "${agent_home}" ]] || continue
    duplicate=0
    for previous_home in "${installed_homes[@]}"; do
      [[ "${previous_home}" != "${agent_home}" ]] || duplicate=1
    done
    [[ "${duplicate}" == "0" ]] || continue
    install_skills "${agent_home}/skills"
    installed_homes+=("${agent_home}")
  done
  if [[ "${#installed_homes[@]}" == "0" ]]; then
    echo 'No existing Agent directory found. Run: hyacinthus skills export --dir <agent-skills-dir>'
  fi
fi
echo 'Restart the Agent session to discover the installed Skills.'
