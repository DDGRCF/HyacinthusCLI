# 改动说明：独立 Pi 镜像从当前源码编译 CLI，并通过正式安装器安装可发现的 Skills。
FROM rust:1.98.0-bookworm AS cli-build
ENV CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0
WORKDIR /build
COPY cli/Cargo.toml cli/Cargo.lock ./
COPY cli/src ./src
COPY cli/assets ./assets
COPY cli/skills ./skills
RUN --mount=type=cache,id=hyacinthus-skills-cli-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=hyacinthus-skills-cli-target,target=/build/target \
    cargo build --locked --release && install -Dm755 target/release/hyacinthus /out/hyacinthus

FROM node:24.14.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 libseccomp2 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @earendil-works/pi-coding-agent@1.0.4
COPY --from=cli-build /out/hyacinthus /usr/local/bin/hyacinthus
COPY cli/npm/hyacinthus-cli /opt/hyacinthus-installer
COPY cli/tests/agent-e2e/docker/pi-runner.mjs /opt/acceptance/pi-runner.mjs
COPY cli/tests/agent-e2e/docker/turn-metrics.mjs /opt/acceptance/turn-metrics.mjs
COPY cli/tests/agent-e2e/lib/reply.mjs /opt/acceptance/reply.mjs
COPY cli/tests/agent-e2e/lib/cli-proxy.mjs cli/tests/agent-e2e/lib/file-queue.mjs cli/tests/agent-e2e/lib/policy.mjs /opt/acceptance/
RUN mkdir -p /workspace /home/node/.pi/agent /home/node/.config/hyacinthus \
    && chown -R node:node /workspace /home/node/.pi /home/node/.config
USER node
ENV PI_CODING_AGENT_DIR=/home/node/.pi/agent AI_AGENT=pi
RUN node /opt/hyacinthus-installer/bin/hyacinthus-cli.js skills install --target pi --install-dir /usr/local/bin
USER root
RUN install -d -m700 /opt/real-cli && mv /usr/local/bin/hyacinthus /opt/real-cli/hyacinthus \
    && ln -s /opt/acceptance/cli-proxy.mjs /usr/local/bin/hyacinthus \
    && chmod 755 /opt/acceptance/cli-proxy.mjs
USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
