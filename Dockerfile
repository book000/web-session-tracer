FROM node:26-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

# hadolint ignore=DL3018
RUN apk update && \
  apk upgrade && \
  apk add --update --no-cache tzdata && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  apk del tzdata && \
  npm install -g corepack@latest && \
  corepack enable

WORKDIR /app

# pnpm hard-links node_modules into the store, and the links break once the
# build cache mount is gone, so copy files instead (node-linker=hoisted).
RUN echo "node-linker=hoisted" >> .npmrc

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY src src

# Keep the pnpm store as a Docker cache to skip package downloads.
# tsx is in dependencies, so --prod still installs every module needed to run.
RUN --mount=type=cache,id=pnpm-hoisted,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod

# Where session data is stored. Mount a host directory to persist it.
# docker run -v /host/sessions:/sessions ...
VOLUME ["/sessions"]

# Chrome remote debugging URL. When connecting over the Docker network,
# specify the host's IP or a service name.
# Example: -e CHROME_URL=http://host.docker.internal:9222
ENV CHROME_URL=http://localhost:9222
ENV SESSION_DIR=/sessions
ENV NETWORK_BUFFER_SIZE=1000

# Enable or disable screenshots (disabled by default).
# When true, a PNG is saved before and after click / submit and after keydown / input.
ENV SCREENSHOT_ENABLED=false

# Also capture a full DOM snapshot after every user action (disabled by default).
# Main-frame navigations are always snapshotted.
ENV FULL_SNAPSHOT_ENABLED=false

ENV NODE_ENV=production

ENTRYPOINT [ "pnpm", "start" ]
