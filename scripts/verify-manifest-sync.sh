#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
asset_manifest="${root}/assets/agent-cli-capabilities.yaml"
parent_manifest="${root}/../docs/agent-cli-capabilities.yaml"

if [[ ! -f "${asset_manifest}" ]]; then
  echo "missing CLI capability manifest asset: ${asset_manifest}" >&2
  exit 1
fi

if [[ -f "${parent_manifest}" ]]; then
  cmp -s "${parent_manifest}" "${asset_manifest}" || {
    echo "capability manifest drift detected" >&2
    echo "sync ${asset_manifest} with ${parent_manifest}" >&2
    exit 1
  }
fi
