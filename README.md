# web-session-tracer

Puppeteer を使って Chrome ブラウザ上のユーザー操作を自動記録するツールです。クリック・キー入力・フォーム送信・ページ遷移・DOM 変更・ネットワーク通信を操作単位でディレクトリに保存します。

## 機能

- **ユーザー操作の記録**: click / keydown / input / submit イベントを捕捉
- **DOM 変更の記録**: MutationObserver による差分ログ（重要度レベル付き）
- **ネットワークの記録**: リクエスト・レスポンス・完了イベントを操作単位で保存
- **DOM スナップショット**: ページ遷移時にフル DOM を保存
- **セキュリティ**: パスワードフィールドの値・キー入力を `***` でマスク
- **SPA 対応**: Vue Router / Next.js など pushState ベースのナビゲーションを検出

## 動作要件

- Node.js 22 以上
- pnpm
- リモートデバッグポートを開放した Chrome

## セットアップ

```bash
pnpm install
```

## 使い方

### 1. Chrome をリモートデバッグモードで起動

```bash
/opt/google/chrome/chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-wst \
  --no-first-run
```

### 2. トレーサーを起動

```bash
pnpm start
```

起動すると Chrome に接続し、セッションの記録を開始します。ブラウザを操作すると `sessions/` ディレクトリに記録が蓄積されます。停止するには `Ctrl+C` または `SIGTERM` を送信します。

```
[Main] Chrome に接続中: http://localhost:9222
[Main] Chrome への接続成功
[SessionManager] セッション開始: session-20260223-020207
[SessionManager] 保存先: /path/to/sessions/session-20260223-020207
[PageTracer] トレース開始: https://example.com/
[Main] トレース中... (Ctrl+C または SIGTERM で停止)
```

### Docker / docker compose で起動する場合

Docker イメージを使って実行することもできます。ホスト側の Chrome に接続する場合は `network_mode: host` が必要です。

```bash
# イメージのビルド
docker build -t web-session-tracer .

# docker compose で起動（compose.yaml がある場合）
docker compose up
```

`compose.yaml` のデフォルト設定：

```yaml
services:
  tracer:
    build: .
    network_mode: host        # ホストの Chrome (localhost:9222) に接続
    volumes:
      - ./sessions:/sessions  # セッションデータをホストに保存
    environment:
      CHROME_URL: http://localhost:9222
      SESSION_DIR: /sessions
```

Chrome はデフォルトで `127.0.0.1` のみでリッスンするため、コンテナ内から到達するには `network_mode: host` でホストのネットワークスタックを共有する必要があります。

別のホスト上の Chrome（`--remote-debugging-address=0.0.0.0` 付きで起動）に接続する場合は `CHROME_URL` を上書きします：

```bash
CHROME_URL=http://192.168.1.10:9222 docker compose up
```

### 3. 記録の確認

```bash
ls sessions/session-*/ops/
```

セッションファイルの詳細は [`sessions/README.md`](sessions/README.md) を参照してください。

## 設定（環境変数）

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CHROME_URL` | `http://localhost:9222` | Chrome リモートデバッグ URL |
| `SESSION_DIR` | `./sessions` | セッションデータの保存先 |
| `NETWORK_BUFFER_SIZE` | `1000` | メモリ上に保持する未完了リクエストの最大数 |
| `SCREENSHOT_ENABLED` | `false` | `true` にすると操作前後のスクリーンショットを保存 |

例:

```bash
CHROME_URL=http://localhost:9222 SESSION_DIR=/data/sessions pnpm start
```

## 開発

```bash
# 型チェック + lint + フォーマットチェック
pnpm lint

# 自動修正
pnpm fix

# ウォッチモード（ファイル変更時に自動再起動）
pnpm dev
```

## アーキテクチャ

```
Chrome
  ↓ Chrome DevTools Protocol (CDP)
PageTracer          - ページ単位の操作記録
  ├── 注入スクリプト  - ブラウザ内で click / keydown / input / submit / MutationObserver を捕捉
  ├── NetworkTracker - CDP 経由でネットワークイベントを収集
  └── SessionStorage - ops/ ディレクトリへの書き込み
SessionManager      - セッション全体の管理
```

## ライセンス

MIT
