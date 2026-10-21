# ONE ORDER

TypeScript・Phaser・Viteを使う、ONE ORDERの開発用リポジトリです。
現在はPhaserの起動確認用シーンのみを含みます。

## 必要な環境

- Node.js 24.x
- npm 11以上（Node.jsに同梱）

Node.jsのバージョン管理ツールを使う場合は、`.nvmrc`の指定を利用できます。

## 起動

リポジトリを取得し、プロジェクトのフォルダで実行します。

```sh
npm ci
npm run dev
```

ブラウザで <http://127.0.0.1:5173> を開きます。
白地に標準文字で「開発環境が起動しました」が表示されれば起動成功です。
ソースを保存するとViteが変更を反映します。

開発サーバーはターミナルで `Ctrl+C` を押すと停止します。
5173番ポートが使用中の場合は、`npm run dev -- --port 5174` などで変更できます。

## コマンド

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動 |
| `npm run typecheck` | TypeScriptの型をチェック |
| `npm run build` | 型チェック後、`dist/`に本番用ファイルを生成 |
| `npm run preview` | 本番用ファイルを <http://127.0.0.1:4173> で確認 |
| `npm test` | Vitestを1回実行 |
| `npm run test:watch` | Vitestを監視モードで実行 |

プレビューの前に `npm run build` を実行してください。
現時点ではゲームルールとテストケースはありません。
`npm test`は、テストがない間も正常終了する設定です。

## 構成

```text
src/
  main.ts                   # アプリの起動と開発中の終了処理
  style.css                 # ページ全体のレイアウト
  game/
    createGame.ts           # Phaserの起動設定
    scenes/
      BootScene.ts          # 起動確認用シーン
index.html                  # ブラウザ側の入口
vite.config.ts              # 開発サーバーとビルドの設定
tsconfig.json               # TypeScriptの設定
```

## 開発方針

AI向けの作業ルールは [AGENTS.md](AGENTS.md) を入口にしています。
ゲームデザインの優先順位、試作時の表示、ゲームルールと描画の分離は
[プロジェクトの目的と実装方針](instructions/project-scope.md) を参照してください。

## 依存関係と確認

`package-lock.json`をコミットし、通常の環境準備には `npm ci` を使います。
依存パッケージを追加・更新するときは `npm install` を使い、
`package.json`と`package-lock.json`を合わせて更新してください。

GitHub Actionsでも `npm ci` と `npm run build` を実行します。
`node_modules/`、`dist/`、ローカル設定や検証用ファイルはGit管理に含めません。
