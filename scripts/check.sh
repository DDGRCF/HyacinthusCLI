#!/usr/bin/env bash
set -euo pipefail

cargo fmt --check
for script in scripts/*.sh; do
  bash -n "${script}"
done
./scripts/verify-manifest-sync.sh
cargo check --locked
cargo test --locked

if cargo clippy --version >/dev/null 2>&1; then
  cargo clippy --locked --all-targets -- -D warnings
else
  echo "clippy component is not installed; skipping cargo clippy" >&2
fi
