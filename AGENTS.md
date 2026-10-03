# js2rust 開發指南

## 專案目的與範圍

這是一個使用原生 JavaScript / Node.js 與 Babel AST，將有明確型別的 JavaScript 子集轉譯成 Rust 的工具。Playground 是主要的互動開發介面。不要把語法成功解析或產生非空 Rust 字串，當作功能已支援的證據。

## 檔案分工

- `src/validation.js`：轉譯前語法、作用域、型別與子集檢查；不得執行使用者原始碼。診斷須區分 JS 問題／轉譯限制，保留檔名及行欄。型別未知時不得當成確定錯誤。
- `src/index.js`：公開的單檔轉譯 API 與 parser 設定。
- `src/codegen.js`：AST 分析、型別／借用處理、Rust 程式碼生成。
- `src/inference.js`、`src/types.js`：參數推導與 JSDoc / Rust 型別映射。
- `src/modules.js`：模組解析、跨檔案資訊、單檔合併與 Cargo 專案生成。
- `src/runtime.js`：產出的 Rust 所需的 JavaScript 語意輔助函式；不得引入 Node.js 執行環境依賴。
- `src/cli.js`：CLI；錯誤必須以非零結束碼回報。
- `playground/`：編輯器、範本、專案備份／匯出及 Node.js 開發伺服器。
- `docs/`、`scripts/build-docs.js`：GitHub Pages 說明頁與由轉譯器生成的範例；修改範例後執行 `npm run docs:build` 與 `npm run docs:verify`，檢查手機／桌面及相對資產路徑。
- `test/`：字串／診斷回歸、真實 Rust 編譯與 JavaScript/Rust 結果對照。

## 開發規則

1. 維持 ESM 與純 JavaScript。新增第三方套件前先評估 Node.js 或 Rust 標準函式庫。
2. 保留公開 API：`transpile`、`transpileMultiModules`、`generateRustProject`。兩種模組輸出都要驗證。
3. 必須保持運算優先序、函式參數預設值、陣列是否被修改、方法回傳值、回呼參數與求值順序。
4. 型別依據明確註解、作用域與使用方式推導；命名只能作為最後的提示，不能覆蓋明確型別。
5. 不支援的語法或已知不相容的語意必須回報含來源位置的錯誤。不得用註解取代程式邏輯後宣告成功。
6. 不要為通過借用檢查而消耗仍需使用的陣列；依元素型別與語意選擇借用、複製或 clone。
7. 不要宣稱支援完整 JavaScript、Node.js、Express 或任意 npm 套件。記錄已驗證的子集與限制。
8. Playground 範本必須能編譯；新增方法應加上可操作的範本。使用者原始碼應可備份，轉譯錯誤不得覆蓋原始碼。
9. 本機 HTTP Server、Cargo 執行或其他新產品功能不應混入無關修正；公開服務需明確設定監聽位址及請求限制。

## 驗證

```bash
npm ci
npm test
npm run test:rust
```

`test:rust` 需要本機 `rustc` 與 `cargo`，在 Windows 也應能執行。缺少工具或 Cargo 相依套件時必須明確失敗，不能把略過當成通過。Rust 測試應比較 Node.js 的實際結果，涵蓋正常案例、空陣列、負索引、方法鏈、陣列再次使用及非預期輸入。

Rust Playground 可作為人工補充驗證，不作為必要的測試依賴。禁止未經授權將私人程式碼送到外部執行服務。

## 提交與報告

- 聚焦目前授權的工作，使用獨立分支，避免 force push。
- PR 說明列出實際修正、驗證結果、已知限制。不得聲稱執行過未執行的測試。
- README、Playground 範本、測試與實作必須一致；不要只放寬測試來掩蓋回歸。
