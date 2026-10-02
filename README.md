# 🦀 js-to-rust

> **用純 JavaScript 的直覺與寫法，轉譯出原生高效的 Rust 程式碼！**  
> Transpile JavaScript compute-heavy algorithms into clean, idiomatic, and native Rust.

---

## ✨ 核心特色 (Features)

* **純 JavaScript 開發**：不需要先搞懂複雜的 TypeScript 設定或編譯器，用標準 Node.js 即可開發與執行。
* **原生 JSDoc 型別支援**：支援用 `@param` 與 `@returns` 標註型別，亦可由轉譯器自動推導數值。
* **智慧型借用與切片 (Auto-Borrowing & Slicing)**：
  * 自動將 JavaScript 陣列映射為 Rust 的切片借用 `&[T]` 或動態向量 `Vec<T>`。
  * 傳遞參數時，自動加上引用符號 `&`，完美符合 Rust Borrow Checker！
* **陣列索引自動轉型**：在 JS 中為數字的索引，自動在 Rust 轉型為 `usize`（如 `items[i as usize]`）。
* **內建函數轉譯**：
  * `console.log(...)` 轉為 `println!(...)`
  * `Math.sqrt`, `Math.floor`, `Math.abs`, `Math.pow` 自動轉為對應的 Rust 語法。
  * `for (let i = 0; i < n; i++)` 自動轉換為經典的 Rust Range `for i in 0..n`。

---

## 🚀 快速開始 (Quick Start)

### 1. 啟動互動式網頁測試介面 (Playground Web UI)

```bash
npm run playground
```

開啟瀏覽器前往 `http://localhost:3000`：
* **左側**：輸入純 JavaScript（支援 JSDoc 或自動推導）。
* **右側**：即時看到轉譯出的 Rust 語法，並提供 **「▶ 在線編譯並執行 Rust」** 按鈕！
* **直接連線官方 Rust Playground**：自動回傳編譯狀態、`stdout` 執行輸出與 `stderr` 編譯訊息。

### 2. 命令列 CLI 執行

```bash
npm start -- test/example.js
```

你也可以直接匯出成 `.rs` 檔案：

```bash
npm start -- test/example.js -o output.rs
```

### 3. 跑單元測試

```bash
npm test
```

---

## 📖 語法對照範例 (Comparison)

### 輸入：JavaScript (`test/example.js`)

```javascript
/**
 * 遞迴斐波那契數列
 * @param {int} n
 * @returns {int}
 */
function fibonacci(n) {
  if (n <= 1) {
    return n;
  }
  return fibonacci(n - 1) + fibonacci(n - 2);
}

/**
 * 質數檢查
 * @param {int} n
 * @returns {bool}
 */
function isPrime(n) {
  if (n <= 1) {
    return false;
  }
  const limit = Math.floor(Math.sqrt(n));
  for (let i = 2; i <= limit; i++) {
    if (n % i === 0) {
      return false;
    }
  }
  return true;
}

/**
 * 陣列總和
 * @param {int[]} nums
 * @returns {int}
 */
function sumArray(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    total += nums[i];
  }
  return total;
}
```

### 自動輸出：Rust

```rust
pub fn fibonacci(n: i64) -> i64 {
    if n <= 1 {
        return n;
    }
    return fibonacci(n - 1) + fibonacci(n - 2);
}

pub fn isPrime(n: i64) -> bool {
    if n <= 1 {
        return false;
    }
    let limit = ((n as f64).sqrt() as i64);
    for i in 2..=limit {
        if n % i == 0 {
            return false;
        }
    }
    return true;
}

pub fn sumArray(nums: &[i64]) -> i64 {
    let mut total = 0;
    for i in 0..(nums.len() as i64) {
        total += nums[i as usize];
    }
    return total;
}
```

---

## 🗺️ 專案架構 (Project Structure)

```text
js-to-rust/
├── package.json        # 專案相依與 npm scripts
├── README.md           # 專案說明文件
├── src/
│   ├── types.js        # JSDoc 型別解析與 Rust 型別映射字典
│   ├── codegen.js      # AST 走訪器與 Rust 代碼生成器 (含自動切片借用)
│   ├── index.js        # 核心轉譯進入點 (transpile API)
│   └── cli.js          # 命令列執行工具 (CLI)
└── test/
    ├── example.js      # 涵蓋遞迴、質數、陣列運算的 JS 範例
    └── run.js          # 自動化測試腳本
```

---

## 🔮 未來展望 (Roadmap)

- [ ] 物件結構體映射（支援 JS Object 轉為 Rust `struct`）
- [ ] 常用陣列方法支援（如 `.push()`, `.pop()`）
- [ ] 效能 Benchmark 測試工具（Node.js vs 編譯出的 Rust 原生二進位效能比較）
- [ ] 網頁版互動式 Playground（Monaco Editor 即時預覽）

---

## 📄 授權 (License)

MIT License
