# GitHub Pages 說明頁

這是 js2rust 的靜態專案說明網站，包含手機版導覽、程式碼對照、支援範圍、CLI 與本機 Playground 操作說明。頁面不需要後端、遠端字型或第三方前端套件。

## 本機預覽

```bash
npm ci
npm run docs:build
npm run docs:serve
```

開啟 http://localhost:4173。`DOCS_PORT` 可調整預覽連接埠。

## 編輯與驗證

- `docs/index.html`：內容與頁面結構。
- `docs/styles.css`：色彩、排版與響應式介面。
- `docs/app.js`：範例切換、複製、完整 Rust 展開與手機導覽。
- `docs/highlight.js`：JavaScript / TypeScript、Rust 與 TOML 的顯示用語法高亮；以文字節點插入來源，不解析 HTML、不執行程式碼。切換範例、展開 Rust 或切換範本檔案時都會重新著色，複製與下載保留原始碼。
- `scripts/docs-examples.js`：說明頁範例的唯一來源。
- `docs/templates-data.js`：從 Playground 範本、標題及分類自動產生，包含所有來源檔案及 Cargo 專案；不要直接編輯。範本庫提供搜尋、分類、逐檔檢視與可匯入 Playground 的 JSON 下載。
- `docs/examples-data.js`：由轉譯器生成；不要直接編輯。

```bash
npm run docs:build
npm run docs:verify
```

驗證需要本機 rustc，會編譯／執行每個說明頁範例，與 Node.js 結果對照，並檢查範例與完整範本庫的生成檔是否與來源一致。17 個 Playground 範本的 Cargo 編譯／執行由 `npm run test:rust` 驗證。複製 Rust 會取得完整程式碼，包含需要的輔助函式。

## 網站圖示

`favicon.svg` 是圖示的向量來源：深綠色圓角底、奶白色 R 字母與橘色斜筆，以簡潔的字母圖形呼應 Rust。圖形使用 path，不依賴字型；頁首、頁尾共用同一個 SVG。

- `favicon-32.png`：32 × 32 分頁圖示，供 PNG 相容性備援。
- `apple-touch-icon.png`：180 × 180 iPhone / iPad 主畫面圖示。
- `icon-512.png`：512 × 512 可重用圖示。

修改 SVG 後，請同步重新輸出以上 PNG 尺寸，保留透明圓角，並檢查 16 / 32px 顯示與 `/js2rust/` 下的相對路徑。

## 發佈至 GitHub Pages

本次只準備網站與部署流程，沒有自動發佈。完成程式修正 PR 與說明頁 PR 的合併後：

1. 在儲存庫 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
2. 進入 **Actions → Deploy documentation to GitHub Pages → Run workflow**，選擇 `main`。
3. 工作流程會重新生成、驗證範例，只上傳 `docs/`，再部署至 `github-pages` 環境。
4. 成功後以 Actions 顯示的 Pages 網址為準。一般專案網址為 `https://bingfenghung.github.io/js2rust/`。

私人儲存庫使用 GitHub Pages 需要 GitHub Pro、Team 或 Enterprise 等支援方案。一般 Pages 網站可能公開，即使來源儲存庫是私人；公開頁面只包含專案介紹與示範程式，不含使用者上傳的程式碼。請依你的帳號與儲存庫狀態設定 Pages，不需要為部署修改原始碼儲存庫的可見性。

Pages 是靜態網站，不能執行 `playground/server.js` 的 Node.js API。本頁引導使用者在本機啟動 Playground，沒有放置無法在 Pages 運作的轉譯／編譯按鈕。

官方說明：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
