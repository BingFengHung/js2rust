# 🦀 js-to-rust

> **用純 JavaScript 的直覺與寫法，轉譯出原生高效的 Rust 程式碼！**  
> Transpile JavaScript compute-heavy algorithms into clean, idiomatic, and native Rust.

---

## ✨ 核心特色 (Features)

* **純 JavaScript 開發**：不需要先搞懂複雜的 TypeScript 設定或編譯器，用標準 Node.js 即可開發與執行。
* **🧠 免註解全域型別推導 (Smart Type Inference)**：
  * **呼叫點型別推導 (Call-Site Inference)**：在 `main()` 呼叫 `ask("12")`，函式定義 `function ask(greet)` 中的 `greet` **自動推導為 `&str`**，完全不需要寫 JSDoc！
  * **參數預設值推導**：`function foo(x = 10)` 自動推導為數值。
  * **語意啟發式推導**：自動識別常見命名（如 `name`, `msg`, `isReady`, `items`）。
* **📦 模組化宣告與引入 (ES Modules -> Rust Modules)**：
  * 支援在 Playground 中以多分頁（Multi-Tabs）進行模組化開發（如 `main.js` + `math.js`）。
  * 自動將 `export function add(...)` 轉換為 Rust 的 `pub mod math { pub fn add(...) }`。
  * 自動將 `import { add } from './math.js'` 轉換為 Rust 的 `use crate::math::add;`。
* **🛡️ 結構體映射 (Rust Structs)**：支援 JSDoc `@typedef`，自動生成帶有 `#[derive(Debug, Clone)]` 的 Rust `struct`。
* **🔥 自動靜態分析可變借用 (`&mut` Auto-Inference)**：函式內若有修改陣列（`arr[0] = 0` 或 `arr.push(x)`），轉譯器自動推導參數為 `&mut Vec<T>`，並在呼叫端自動補上 `&mut`！
* **🎯 模式匹配 (Pattern Matching)**：將 JavaScript 的 `switch / case` 自動轉譯為 Rust 原生的 `match` 表達式！
* **✨ 範本字串與格式化**：自動將 `` `Hello ${name}` `` 轉譯為 Rust 的 `format!("Hello {}", name)`。
* **🔀 三元運算子**：`cond ? a : b` 自動轉換為 Rust 表達式 `if cond { a } else { b }`。
* **📦 容器方法**：支援陣列 `.push()`、`.pop()`、`.includes()`（包含負起始索引及 NaN 相等判斷）。
* **智慧型借用與切片 (Auto-Borrowing & Slicing)**：
  * 自動將 JavaScript 陣列映射為 Rust 的切片借用 `&[T]` 或動態向量 `Vec<T>`。
  * 傳遞參數時，自動加上引用符號 `&`，依已推導的型別選擇借用。
* **陣列索引自動轉型**：在 JS 中為數字的索引，自動在 Rust 轉型為 `usize`（如 `items[i as usize]`）。
* **內建函數轉譯**：
  * `console.log(...)` 轉為 `println!(...)`
  * `Math.sqrt`, `Math.floor`, `Math.abs`, `Math.pow` 自動轉為對應的 Rust 語法。
  * 固定上界且不修改索引的遞增迴圈使用 Rust Range；其他迴圈保留每次條件判斷與 continue 更新。

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

### 3. 安裝與驗證

```bash
npm ci
npm test
npm run test:rust
```

`npm test` 檢查轉譯輸出、診斷及 Playground 範本。`test:rust` 需要本機 Rust 工具鏈（`rustc`、`cargo`）：編譯並執行產出的 Rust，與 Node.js 執行同一段 JavaScript 的結果對照；另外驗證合併模組、完整 Cargo 專案及每個 Playground 範本。非同步範本使用 Tokio，首次執行需要下載 Cargo 相依套件。缺少工具會失敗，不會略過。

## 已驗證的方法與範圍

| 方法 | 已驗證的行為 |
| --- | --- |
| `map`、`filter` | 值／索引回呼、空陣列、字串元素、保留原陣列 |
| `reduce` | 有／無初始值、索引、字串與浮點累加；空陣列且未提供初始值會失敗 |
| `forEach`、`some`、`every`、`find` | 捕捉外部變數、索引、短路、空陣列、忽略 forEach 回傳值 |
| 字串 `split` | 字串分隔符、尾端空字串、空／省略分隔符、limit、方法鏈 |
| `splice` | 修改原陣列並回傳移除元素、插入／替換、負索引、省略 deleteCount、邊界截斷 |
| `slice` | 回傳獨立陣列、負索引、起訖邊界截斷 |
| `push`、`pop`、`includes`、`indexOf`、`join` | 多元素 push 的長度回傳、空陣列 pop、起始索引、includes 的 NaN 比對 |

這是具有明確型別的 JavaScript 子集，並非完整 JavaScript 執行環境。陣列需使用相同型別的元素；回呼目前需內嵌函式，支援值／索引，reduce 另有累加器，不支援回呼的 array 參數或修改來源陣列。`find`／`pop` 的缺值以 Rust `Option` 表示。

`split` 不支援正規表示式；空分隔符遇到 emoji 等非 BMP 字元會明確在執行時失敗，因為 Rust String 無法表示 JavaScript 分割後的獨立 UTF-16 surrogate。未支援的方法（例如 sort、reverse、flat）會回報錯誤。

整數預設為 i64，除法及浮點運算使用 f64；整數溢位、非有限值轉整數、JavaScript 隱式型別轉換及物件身分比較尚未等同完整 JS 語意。模組支援明確副檔名的相對具名／預設函式匯入；不支援 namespace imports、Node.js 內建模組或任意 npm 套件。建立 HTTP Server 仍需額外的 Rust 網路 API 對接。

Playground 可作為主要編輯介面，請定期匯出專案備份，並將程式碼與測試提交到 Git。正式驗證以本機 `test:rust` 為準；在線執行按鈕會將 Rust 程式碼傳送到官方 Rust Playground。


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
    let limit = ((n as f64).sqrt().floor() as i64);
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
├── AGENTS.md           # 開發與驗證規範
├── src/
│   ├── runtime.js      # JS 方法語意的 Rust 輔助函式
│   ├── inference.js    # 參數型別推導
│   ├── modules.js      # 模組與 Cargo 專案生成
│   ├── types.js        # JSDoc 型別解析與 Rust 型別映射字典
│   ├── codegen.js      # AST 走訪器與 Rust 代碼生成器 (含自動切片借用)
│   ├── index.js        # 核心轉譯進入點 (transpile API)
│   └── cli.js          # 命令列執行工具 (CLI)
├── playground/         # 編輯器、方法範本及開發伺服器
└── test/
    ├── example.js      # 涵蓋遞迴、質數、陣列運算的 JS 範例
    ├── run.js          # 輸出與診斷回歸
    ├── cases.js        # JS / Rust 語意對照案例
    └── rust.js         # 真實 Rust 編譯、執行與範本驗證
```

---

## 🔮 未來展望 (Roadmap)

- [x] JSDoc 物件結構體映射
- [x] 常用陣列／字串方法及真實 Rust 執行回歸
- [ ] 效能 Benchmark 測試工具（Node.js vs 編譯出的 Rust 原生二進位效能比較）
- [x] 網頁版互動式 Playground（Monaco Editor 即時預覽）
- [ ] 擴充 UTF-16、動態型別與回呼修改來源陣列等相容性

---

## 📄 授權 (License)

MIT License

