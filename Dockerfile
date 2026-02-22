FROM node:24-alpine

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

# pnpm ハードリンクではなくファイルコピーを使う設定。
# pnpm はデフォルトでストアへのハードリンクで node_modules を構成するが、
# Docker ビルド後にキャッシュマウントが消えるとリンクが切れるため、
# node-linker=hoisted でファイルをコピーする方式に切り替える。
RUN echo "node-linker=hoisted" >> .npmrc

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src src

# pnpm store を Docker キャッシュとして保持し、パッケージダウンロードをスキップする。
# キャッシュ ID を pnpm-hoisted とすることで、旧キャッシュ (prod のみ) との衝突を防ぐ。
# tsx は dependencies に含まれるため --prod でインストールしても実行に必要なモジュールが揃う。
RUN --mount=type=cache,id=pnpm-hoisted,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod

# セッションデータの保存先。ホスト側ディレクトリをマウントして永続化する。
# docker run -v /host/sessions:/sessions ...
VOLUME ["/sessions"]

# Chrome のリモートデバッグ URL。Docker ネットワーク経由で接続する場合は
# ホスト側の IP またはサービス名を指定する。
# 例: -e CHROME_URL=http://host.docker.internal:9222
ENV CHROME_URL=http://localhost:9222
ENV SESSION_DIR=/sessions
ENV NETWORK_BUFFER_SIZE=1000

# スクリーンショット撮影の有効/無効 (デフォルト無効)
# true にすると click/submit 前後・keydown/input 後に PNG を保存する
ENV SCREENSHOT_ENABLED=false

ENV NODE_ENV=production

ENTRYPOINT [ "pnpm", "start" ]
