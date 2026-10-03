// Generated from playground/index.html by npm run docs:build.
window.JS2RUST_TEMPLATES = [
  {
    "id": "dim_basic",
    "title": "1-1. 基礎運算與控制流 (If/Else, While, Loop, Primitives)",
    "category": "🧮 1. 基礎語言與演算法 (Core Language)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧮 1-1. 基礎運算與控制流 (If/Else, While, Loop, Primitives)\nfunction calculateTax(income) {\n  if (income > 100000) {\n    return income * 0.3;\n  } else if (income > 50000) {\n    return income * 0.2;\n  } else {\n    return income * 0.1;\n  }\n}\n\nfunction main() {\n  console.log(\"=== 基礎控制流與迴圈 ===\");\n  let sum = 0;\n  for (let i = 1; i <= 5; i++) {\n    sum += i;\n  }\n  console.log(\"1 到 5 累加總和:\", sum);\n\n  const tax = calculateTax(75000);\n  console.log(\"75,000 所得稅額:\", tax);\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\npub fn calculateTax(income: i64) -> f64 {\n    if (income > 100000) {\n        return (((income) as f64) * 0.3);\n    } else if (income > 50000) {\n        return (((income) as f64) * 0.2);\n    } else {\n        return (((income) as f64) * 0.1);\n    }\n}\n\nfn main() {\n    println!(\"{}\", \"=== 基礎控制流與迴圈 ===\");\n    let mut sum = 0;\n    for i in 1..=5 {\n        sum += i;\n    }\n    println!(\"{} {}\", \"1 到 5 累加總和:\", sum);\n    let tax = calculateTax(75000);\n    println!(\"{} {}\", \"75,000 所得稅額:\", tax);\n}\n"
    }
  },
  {
    "id": "dim_vectors",
    "title": "1-2. 向量與動態陣列 (Vec, push, pop, slice, index)",
    "category": "🧮 1. 基礎語言與演算法 (Core Language)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧮 1-2. 向量與動態陣列 (Vec, push, pop, slice, index)\nfunction main() {\n  console.log(\"=== Rust Vec<T> 動態陣列操作 ===\");\n  const numbers = [10, 20, 30];\n\n  // 動態添加元素\n  numbers.push(40);\n  numbers.push(50);\n  console.log(\"添加元素後陣列長度:\", numbers.length);\n\n  // 彈出末端元素\n  const popped = numbers.pop();\n  console.log(\"彈出最後元素:\", popped);\n\n  // 檢查元素是否存在 (contains)\n  const hasTwenty = numbers.includes(20);\n  console.log(\"陣列是否包含 20:\", hasTwenty);\n\n  // 索引取值\n  console.log(\"第一個元素:\", numbers[0]);\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n#[allow(dead_code)]\nmod __js2rust {\n    pub fn index(value: f64, len: usize) -> usize {\n        let value = if value.is_nan() { 0.0 } else { value.trunc() };\n        if value < 0.0 { (len as f64 + value).max(0.0) as usize }\n        else { value.min(len as f64) as usize }\n    }\n\n    pub fn slice<T: Clone>(values: &[T], start: f64, end: Option<f64>) -> Vec<T> {\n        let start = index(start, values.len());\n        let end = end.map(|v| index(v, values.len())).unwrap_or(values.len());\n        values[start..end.max(start)].to_vec()\n    }\n\n    pub fn splice<T>(values: &mut Vec<T>, start: f64, delete: Option<f64>, items: Vec<T>) -> Vec<T> {\n        let start = index(start, values.len());\n        let count = delete.map(|v| if v.is_nan() { 0 } else { v.trunc().max(0.0) as usize })\n            .unwrap_or(values.len() - start).min(values.len() - start);\n        values.splice(start..start + count, items).collect()\n    }\n\n    pub fn split(text: &str, separator: Option<&str>, limit: Option<f64>) -> Vec<String> {\n        let limit = limit.map(|v| {\n            if !v.is_finite() { 0usize } else { v.trunc().rem_euclid(4294967296.0) as usize }\n        }).unwrap_or(u32::MAX as usize);\n        if limit == 0 { return Vec::new(); }\n        match separator {\n            None => vec![text.to_string()],\n            Some(\"\") => {\n                // Rust String cannot represent lone UTF-16 surrogates. Fail explicitly.\n                assert!(!text.chars().any(|c| c as u32 > 0xffff),\n                    \"js2rust: split with an empty separator on non-BMP text is unsupported\");\n                text.chars().take(limit).map(|c| c.to_string()).collect()\n            }\n            Some(separator) => text.split(separator).take(limit).map(str::to_string).collect(),\n        }\n    }\n\n    pub fn join<T: std::fmt::Display>(values: &[T], separator: &str) -> String {\n        values.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(separator)\n    }\n\n    pub trait SameValueZero { fn same(&self, other: &Self) -> bool; }\n    impl SameValueZero for i64 { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for i32 { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for usize { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for bool { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for String { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for f64 {\n        fn same(&self, other: &Self) -> bool { self == other || (self.is_nan() && other.is_nan()) }\n    }\n    pub fn includes<T: SameValueZero>(values: &[T], value: &T, start: f64) -> bool {\n        values[index(start, values.len())..].iter().any(|v| v.same(value))\n    }\n    pub fn index_of<T: PartialEq>(values: &[T], value: &T, start: f64) -> i64 {\n        let start = index(start, values.len());\n        values[start..].iter().position(|v| v == value).map(|i| (i + start) as i64).unwrap_or(-1)\n    }\n}\n\nfn main() {\n    println!(\"{}\", \"=== Rust Vec<T> 動態陣列操作 ===\");\n    let mut numbers: Vec<i64> = vec![10, 20, 30];\n    { let __items = vec![40]; let __values = &mut numbers; __values.extend(__items); __values.len() as i64 };\n    { let __items = vec![50]; let __values = &mut numbers; __values.extend(__items); __values.len() as i64 };\n    println!(\"{} {}\", \"添加元素後陣列長度:\", (numbers.len() as i64));\n    let popped = numbers.pop();\n    println!(\"{} {}\", \"彈出最後元素:\", match &(popped) { Some(v) => format!(\"{}\", v), None => \"undefined\".to_string() });\n    let hasTwenty = __js2rust::includes(&numbers, &20, 0.0);\n    println!(\"{} {}\", \"陣列是否包含 20:\", hasTwenty);\n    println!(\"{} {}\", \"第一個元素:\", numbers[(0) as usize]);\n}\n"
    }
  },
  {
    "id": "dim_methods",
    "title": "陣列與字串方法：map / reduce / split / splice",
    "category": "🧮 1. 基礎語言與演算法 (Core Language)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 每個方法都有 Node.js 與實際 Rust 執行結果對照測試\nfunction main() {\n  const numbers = [1, 2, 3, 4];\n  const doubled = numbers.map((value, index) => value * 2 + index);\n  const selected = doubled.filter(value => value > 4);\n  const total = selected.reduce((sum, value) => sum + value, 0);\n  console.log(\"map:\", doubled);\n  console.log(\"filter:\", selected);\n  console.log(\"reduce:\", total);\n  console.log(\"原陣列仍可使用:\", numbers);\n\n  const words = \"台灣,JavaScript,Rust\".split(\",\");\n  console.log(\"split + map + join:\", words.map(word => word + \"!\").join(\" | \"));\n\n  const removed = numbers.splice(-2, 1, 99, 100);\n  console.log(\"splice 刪除的元素:\", removed);\n  console.log(\"splice 修改後:\", numbers);\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n#[allow(dead_code)]\nmod __js2rust {\n    pub fn index(value: f64, len: usize) -> usize {\n        let value = if value.is_nan() { 0.0 } else { value.trunc() };\n        if value < 0.0 { (len as f64 + value).max(0.0) as usize }\n        else { value.min(len as f64) as usize }\n    }\n\n    pub fn slice<T: Clone>(values: &[T], start: f64, end: Option<f64>) -> Vec<T> {\n        let start = index(start, values.len());\n        let end = end.map(|v| index(v, values.len())).unwrap_or(values.len());\n        values[start..end.max(start)].to_vec()\n    }\n\n    pub fn splice<T>(values: &mut Vec<T>, start: f64, delete: Option<f64>, items: Vec<T>) -> Vec<T> {\n        let start = index(start, values.len());\n        let count = delete.map(|v| if v.is_nan() { 0 } else { v.trunc().max(0.0) as usize })\n            .unwrap_or(values.len() - start).min(values.len() - start);\n        values.splice(start..start + count, items).collect()\n    }\n\n    pub fn split(text: &str, separator: Option<&str>, limit: Option<f64>) -> Vec<String> {\n        let limit = limit.map(|v| {\n            if !v.is_finite() { 0usize } else { v.trunc().rem_euclid(4294967296.0) as usize }\n        }).unwrap_or(u32::MAX as usize);\n        if limit == 0 { return Vec::new(); }\n        match separator {\n            None => vec![text.to_string()],\n            Some(\"\") => {\n                // Rust String cannot represent lone UTF-16 surrogates. Fail explicitly.\n                assert!(!text.chars().any(|c| c as u32 > 0xffff),\n                    \"js2rust: split with an empty separator on non-BMP text is unsupported\");\n                text.chars().take(limit).map(|c| c.to_string()).collect()\n            }\n            Some(separator) => text.split(separator).take(limit).map(str::to_string).collect(),\n        }\n    }\n\n    pub fn join<T: std::fmt::Display>(values: &[T], separator: &str) -> String {\n        values.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(separator)\n    }\n\n    pub trait SameValueZero { fn same(&self, other: &Self) -> bool; }\n    impl SameValueZero for i64 { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for i32 { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for usize { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for bool { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for String { fn same(&self, other: &Self) -> bool { self == other } }\n    impl SameValueZero for f64 {\n        fn same(&self, other: &Self) -> bool { self == other || (self.is_nan() && other.is_nan()) }\n    }\n    pub fn includes<T: SameValueZero>(values: &[T], value: &T, start: f64) -> bool {\n        values[index(start, values.len())..].iter().any(|v| v.same(value))\n    }\n    pub fn index_of<T: PartialEq>(values: &[T], value: &T, start: f64) -> i64 {\n        let start = index(start, values.len());\n        values[start..].iter().position(|v| v == value).map(|i| (i + start) as i64).unwrap_or(-1)\n    }\n}\n\nfn main() {\n    let mut numbers: Vec<i64> = vec![1, 2, 3, 4];\n    let doubled: Vec<i64> = numbers.iter().cloned().enumerate().map(|(__index, __value)| -> i64 { let value = __value; let index = __index as i64; ((value * 2) + index) }).collect::<Vec<_>>();\n    let selected: Vec<i64> = doubled.iter().cloned().filter(|__value| -> bool { let value = (*__value).clone(); (value > 4) }).collect::<Vec<_>>();\n    let total = selected.iter().cloned().fold(0, |__acc, __value| -> i64 { let sum = __acc; let value = __value; (sum + value) });\n    println!(\"{} {:?}\", \"map:\", doubled);\n    println!(\"{} {:?}\", \"filter:\", selected);\n    println!(\"{} {}\", \"reduce:\", total);\n    println!(\"{} {:?}\", \"原陣列仍可使用:\", numbers);\n    let words: Vec<String> = __js2rust::split(&(\"台灣,JavaScript,Rust\"), Some(&(\",\")), None);\n    println!(\"{} {}\", \"split + map + join:\", __js2rust::join(&words.iter().cloned().map(|__value| -> String { let word = __value; format!(\"{}{}\", word, \"!\") }).collect::<Vec<_>>(), &(\" | \")));\n    let removed: Vec<i64> = { let __start = (((-2)) as f64); let __count = Some(((1) as f64)); let __items = vec![99, 100]; __js2rust::splice(&mut numbers, __start, __count, __items) };\n    println!(\"{} {:?}\", \"splice 刪除的元素:\", removed);\n    println!(\"{} {:?}\", \"splice 修改後:\", numbers);\n}\n"
    }
  },
  {
    "id": "dim_inference",
    "title": "1-3. 免註解型別推導 (Type Inference & &mut 借用)",
    "category": "🧮 1. 基礎語言與演算法 (Core Language)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧮 1-3. 免註解型別推導 (Type Inference & &mut 借用)\n// 💡 編譯器會自動分析函數呼叫處傳入的參數，並依據函數內部的修改行為推導 &mut\nfunction appendItem(list, item) {\n  list.push(item);\n}\n\nfunction greetUser(name) {\n  console.log(\"您好，歡迎:\", name);\n}\n\nfunction main() {\n  const nums = [1, 2, 3];\n  // 呼叫處傳入 nums，編譯器自動推導 list: &mut Vec<i64> 並提升為 let mut nums\n  appendItem(nums, 4);\n\n  greetUser(\"Ferris (Rust 吉祥物)\");\n  console.log(\"修改後的陣列長度:\", nums.length);\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\npub fn appendItem(list: &mut Vec<i64>, item: i64) {\n    { let __items = vec![item]; let __values = &mut *list; __values.extend(__items); __values.len() as i64 };\n}\n\npub fn greetUser(name: &str) {\n    println!(\"{} {}\", \"您好，歡迎:\", name);\n}\n\nfn main() {\n    let mut nums: Vec<i64> = vec![1, 2, 3];\n    appendItem(&mut nums, 4);\n    greetUser(\"Ferris (Rust 吉祥物)\");\n    println!(\"{} {}\", \"修改後的陣列長度:\", (nums.len() as i64));\n}\n"
    }
  },
  {
    "id": "dim_advanced_struct",
    "title": "1-4. JSDoc 結構體定義 (@typedef & property)",
    "category": "🧮 1. 基礎語言與演算法 (Core Language)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧮 1-4. JSDoc 結構體定義 (@typedef & property)\n/**\n * @typedef {Object} Point\n * @property {float} x\n * @property {float} y\n */\n\nfunction distanceFromOrigin(p) {\n  return Math.sqrt(p.x * p.x + p.y * p.y);\n}\n\nfunction main() {\n  const pt = { x: 3.0, y: 4.0 };\n  console.log(\"座標點點距原點距離:\", distanceFromOrigin(pt));\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n#[derive(Debug, Clone)]\npub struct Point {\n    pub x: f64,\n    pub y: f64,\n}\n\npub fn distanceFromOrigin(p: &Point) -> f64 {\n    return ((((p.x * p.x) + (p.y * p.y))) as f64).sqrt();\n}\n\nfn main() {\n    let pt = Point { x: 3.0, y: 4.0 };\n    println!(\"{} {}\", \"座標點點距原點距離:\", distanceFromOrigin(&pt));\n}\n"
    }
  },
  {
    "id": "dim_modules",
    "title": "2-1. 巢狀資料夾與模組工程 (src/utils/math.js & Cargo.toml)",
    "category": "📦 2. 模組工程與物件導向 (Modules & OOP)",
    "folders": [
      "src",
      "src/utils"
    ],
    "files": {
      "src/main.js": "// 📦 2-1. 巢狀資料夾與模組工程 (src/utils/math.js & Cargo.toml)\n// 編譯器會自動生成包含樹狀 mod.rs、main.rs 與 Cargo.toml 的完整 Rust 專案\nimport { add, multiply } from './utils/math.js';\n\nfunction main() {\n  const sum = add(30, 70);\n  console.log(\"從 utils/math 呼叫 30 + 70 =\", sum);\n\n  const product = multiply(6, 9);\n  console.log(\"從 utils/math 呼叫 6 * 9 =\", product);\n}",
      "src/utils/math.js": "/**\n * 位於 src/utils 資料夾下的數學模組\n */\nexport function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/utils/math.rs": "pub fn add(a: i64, b: i64) -> i64 {\n    return (a + b);\n}\n\npub fn multiply(a: i64, b: i64) -> i64 {\n    return (a * b);\n}\n",
      "src/utils/mod.rs": "pub mod math;\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nmod utils;\n\nuse crate::utils::math::add;\nuse crate::utils::math::multiply;\n\nfn main() {\n    let sum = add(30, 70);\n    println!(\"{} {}\", \"從 utils/math 呼叫 30 + 70 =\", sum);\n    let product = multiply(6, 9);\n    println!(\"{} {}\", \"從 utils/math 呼叫 6 * 9 =\", product);\n}\n"
    }
  },
  {
    "id": "dim_oop",
    "title": "2-2. 物件導向與方法封裝 (ES6 class -> struct + impl)",
    "category": "📦 2. 模組工程與物件導向 (Modules & OOP)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 📦 2-2. 物件導向與方法封裝 (ES6 class -> struct + impl)\nclass BankAccount {\n  constructor(owner, balance) {\n    this.owner = owner;\n    this.balance = balance;\n  }\n\n  // 靜態分析偵測到修改 this 屬性 -> 自動標記為 (&mut self)\n  deposit(amount) {\n    this.balance += amount;\n  }\n\n  // 靜態分析偵測到僅讀取 this 屬性 -> 自動標記為 (&self)\n  getBalance() {\n    return this.balance;\n  }\n}\n\nfunction main() {\n  const acc = new BankAccount(\"Alice\", 100);\n  acc.deposit(50);\n  console.log(\"帳戶擁有者:\", acc.owner);\n  console.log(\"存入 50 後餘額:\", acc.getBalance());\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n#[derive(Debug, Clone)]\npub struct BankAccount {\n    pub owner: String,\n    pub balance: i64,\n}\n\nimpl BankAccount {\n    pub fn new(owner: String, balance: i64) -> Self {\n        Self {\n            owner,\n            balance,\n        }\n    }\n\n    pub fn deposit(&mut self, amount: i64) {\n        self.balance += amount;\n    }\n\n    pub fn getBalance(&self) -> i64 {\n        return self.balance;\n    }\n}\n\nfn main() {\n    let mut acc = BankAccount::new(\"Alice\".to_string(), 100);\n    acc.deposit(50);\n    println!(\"{} {}\", \"帳戶擁有者:\", acc.owner);\n    println!(\"{} {:?}\", \"存入 50 後餘額:\", acc.getBalance());\n}\n"
    }
  },
  {
    "id": "dim_export_default",
    "title": "2-3. 預設導出與外部模組 (export default & import)",
    "category": "📦 2. 模組工程與物件導向 (Modules & OOP)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 📦 2-3. 預設導出與外部模組 (export default & import)\nimport calculator from './calculator.js';\n\nfunction main() {\n  const result = calculator(25, 75);\n  console.log(\"從 calculator 模組計算 25 + 75 =\", result);\n}",
      "src/calculator.js": "/**\n * 預設導出函數 (export default)\n */\nexport default function calculator(a, b) {\n  return a + b;\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/calculator.rs": "pub fn calculator(a: i64, b: i64) -> i64 {\n    return (a + b);\n}\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nmod calculator;\n\nuse crate::calculator::calculator;\n\nfn main() {\n    let result = calculator(25, 75);\n    println!(\"{} {}\", \"從 calculator 模組計算 25 + 75 =\", result);\n}\n"
    }
  },
  {
    "id": "dim_threads",
    "title": "3-1. 多執行緒派生 (thread::spawn + join + sleep)",
    "category": "🧵 3. 併發與非同步程式設計 (Concurrency & Async)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧵 3-1. 多執行緒派生 (thread::spawn + join + sleep)\nfunction main() {\n  console.log(\"【主執行緒】準備啟動背景計算子執行緒...\");\n\n  // 派生背景子執行緒 (thread.spawn)\n  const handle = thread.spawn(() => {\n    for (let i = 1; i <= 3; i++) {\n      console.log(\"【子執行緒】平行運算進度:\", i);\n      thread.sleep(100);\n    }\n  });\n\n  for (let i = 1; i <= 2; i++) {\n    console.log(\"【主執行緒】同步執行主要任務:\", i);\n  }\n\n  // 等待子執行緒執行完成 (join)\n  handle.join();\n  console.log(\"【主執行緒】所有平行運算皆已完成！\");\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nuse std::thread;\nuse std::time::Duration;\n\nfn main() {\n    println!(\"{}\", \"【主執行緒】準備啟動背景計算子執行緒...\");\n    let handle = thread::spawn(move || {\n        for i in 1..=3 {\n            println!(\"{} {}\", \"【子執行緒】平行運算進度:\", i);\n            thread::sleep(Duration::from_millis(100));\n        }\n    });\n    for i in 1..=2 {\n        println!(\"{} {}\", \"【主執行緒】同步執行主要任務:\", i);\n    }\n    handle.join().unwrap();\n    println!(\"{}\", \"【主執行緒】所有平行運算皆已完成！\");\n}\n"
    }
  },
  {
    "id": "dim_mpsc",
    "title": "3-2. 通道訊息傳遞 (mpsc::channel send/recv)",
    "category": "🧵 3. 併發與非同步程式設計 (Concurrency & Async)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧵 3-2. 通道訊息傳遞 (mpsc::channel send/recv)\n// Rust 哲學：不要透過共享記憶體來溝通，而是透過溝通來共享記憶體\nfunction main() {\n  console.log(\"=== 建立 MPSC 通道 ===\");\n  const [tx, rx] = mpsc.channel();\n\n  const worker = thread.spawn(() => {\n    console.log(\"【子執行緒】正在計算關鍵數據...\");\n    const secret = 42 * 2;\n    // 發送計算結果至通道\n    tx.send(secret);\n  });\n\n  // 主執行緒阻塞等待接收數據\n  const result = rx.recv();\n  console.log(\"【主執行緒】成功從通道接收到數值:\", result);\n\n  worker.join();\n  console.log(\"=== 通道通訊圓滿完成 ===\");\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nuse std::thread;\nuse std::sync::mpsc;\n\nfn main() {\n    println!(\"{}\", \"=== 建立 MPSC 通道 ===\");\n    let (tx, rx) = mpsc::channel();\n    let worker = thread::spawn(move || {\n        println!(\"{}\", \"【子執行緒】正在計算關鍵數據...\");\n        let secret = (42 * 2);\n        tx.send(secret).unwrap();\n    });\n    let result = rx.recv().unwrap();\n    println!(\"{} {:?}\", \"【主執行緒】成功從通道接收到數值:\", result);\n    worker.join().unwrap();\n    println!(\"{}\", \"=== 通道通訊圓滿完成 ===\");\n}\n"
    }
  },
  {
    "id": "dim_mutex",
    "title": "3-3. 共享狀態互斥鎖 (Arc<Mutex> lock & mutate)",
    "category": "🧵 3. 併發與非同步程式設計 (Concurrency & Async)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧵 3-3. 共享狀態互斥鎖 (Arc<Mutex> lock & mutate)\n// Arc (原子引用計數) + Mutex (互斥鎖)：保證多執行緒安全修改同一筆狀態\nfunction main() {\n  const counter = Arc.new(Mutex.new(0));\n  let handles = [];\n\n  console.log(\"=== 啟動 5 個執行緒競爭修改共享計數器 ===\");\n\n  for (let i = 0; i < 5; i++) {\n    const counter_clone = Arc.clone(counter);\n    const handle = thread.spawn(() => {\n      // 取得互斥鎖 (lock)，離開區塊自動釋放鎖\n      let num = counter_clone.lock();\n      num.val += 1;\n      console.log(\"執行緒累加成功！\");\n    });\n    handles.push(handle);\n  }\n\n  for (const h of handles) {\n    h.join();\n  }\n\n  console.log(\"【最終計數結果】:\", counter.lock().val);\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nuse std::thread;\nuse std::sync::{Arc, Mutex};\n\nfn main() {\n    let counter = Arc::new(Mutex::new(0));\n    let mut handles = vec![];\n    println!(\"{}\", \"=== 啟動 5 個執行緒競爭修改共享計數器 ===\");\n    for i in 0..5 {\n        let counter_clone = Arc::clone(&counter);\n        let handle = thread::spawn(move || {\n            let mut num = counter_clone.lock().unwrap();\n            *num += 1;\n            println!(\"{}\", \"執行緒累加成功！\");\n        });\n        { let __items = vec![handle]; let __values = &mut handles; __values.extend(__items); __values.len() as i64 };\n    }\n    for h in handles {\n        h.join().unwrap();\n    }\n    println!(\"{} {:?}\", \"【最終計數結果】:\", *counter.lock().unwrap());\n}\n"
    }
  },
  {
    "id": "dim_async",
    "title": "3-4. 非同步函數與 Tokio (async / await & #[tokio::main])",
    "category": "🧵 3. 併發與非同步程式設計 (Concurrency & Async)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🧵 3-4. 非同步函數與 Tokio (async / await & #[tokio::main])\nasync function fetchRemoteData() {\n  console.log(\"【非同步背景】正在非同步獲取資料...\");\n  return 100;\n}\n\nasync function calculateBonus(base) {\n  return base * 2;\n}\n\n// 主程式宣告為 async，自動生成 #[tokio::main] 進入點與 Cargo.toml 依賴\nasync function main() {\n  console.log(\"=== 主程式非同步啟動 ===\");\n\n  const rawData = await fetchRemoteData();\n  console.log(\"收到原始資料:\", rawData);\n\n  const bonus = await calculateBonus(rawData);\n  console.log(\"計算後總分:\", bonus);\n\n  console.log(\"=== 非同步任務順利完成 ===\");\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\ntokio = { version = \"1\", features = [\"full\"] }\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\npub async fn fetchRemoteData() -> i64 {\n    println!(\"{}\", \"【非同步背景】正在非同步獲取資料...\");\n    return 100;\n}\n\npub async fn calculateBonus(base: i64) -> i64 {\n    return (base * 2);\n}\n\n#[tokio::main]\nasync fn main() {\n    println!(\"{}\", \"=== 主程式非同步啟動 ===\");\n    let rawData = fetchRemoteData().await;\n    println!(\"{} {}\", \"收到原始資料:\", rawData);\n    let bonus = calculateBonus(rawData).await;\n    println!(\"{} {}\", \"計算後總分:\", bonus);\n    println!(\"{}\", \"=== 非同步任務順利完成 ===\");\n}\n"
    }
  },
  {
    "id": "dim_enums",
    "title": "4-1. 列舉型別與樣式比對 (enum & switch/match)",
    "category": "🛡️ 4. 系統底層與進階特性 (Systems & Advanced)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🛡️ 4-1. 列舉型別與樣式比對 (enum & switch/match)\nenum Direction {\n  North,\n  South,\n  East,\n  West\n}\n\nfunction main() {\n  const dir = Direction.North;\n  // switch 在 Rust 中會自動轉換為窮舉樣式比對 (match)\n  switch (dir) {\n    case Direction.North:\n      console.log(\"朝向北方前進 (Heading North!)\");\n      break;\n    case Direction.South:\n      console.log(\"朝向南方前進 (Heading South!)\");\n      break;\n    default:\n      console.log(\"朝向其他方位\");\n  }\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\n#[derive(Debug, Clone, Copy, PartialEq, Eq)]\npub enum Direction {\n    North,\n    South,\n    East,\n    West,\n}\n\n\nfn main() {\n    let dir = Direction::North;\n    '__js2rust_switch_0: {\n        let __js2rust_value_0 = dir;\n        let __js2rust_case_0 = match &__js2rust_value_0 {\n            __v if *__v == Direction::North => 0usize,\n            __v if *__v == Direction::South => 1usize,\n            _ => 2usize,\n        };\n        if __js2rust_case_0 <= 0 {\n            println!(\"{}\", \"朝向北方前進 (Heading North!)\");\n            break '__js2rust_switch_0;\n        }\n        if __js2rust_case_0 <= 1 {\n            println!(\"{}\", \"朝向南方前進 (Heading South!)\");\n            break '__js2rust_switch_0;\n        }\n        if __js2rust_case_0 <= 2 {\n            println!(\"{}\", \"朝向其他方位\");\n        }\n    }\n}\n"
    }
  },
  {
    "id": "dim_lifetimes",
    "title": "4-2. 顯式生命週期標註 (@lifetime 'a & 借用檢查)",
    "category": "🛡️ 4. 系統底層與進階特性 (Systems & Advanced)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🛡️ 4-2. 顯式生命週期標註 (@lifetime 'a & 借用檢查)\n// 透過 JSDoc @lifetime 標註，自動為 Rust 生成生命週期泛型參數 <'a>\n/**\n * @lifetime 'a\n * @param {&'a str} x\n * @param {&'a str} y\n * @returns {&'a str}\n */\nfunction longest(x, y) {\n  if (x.length > y.length) {\n    return x;\n  }\n  return y;\n}\n\nfunction main() {\n  const s1 = \"short\";\n  const s2 = \"longer_string\";\n  const result = longest(s1, s2);\n  console.log(\"最長字串為:\", result);\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\npub fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {\n    if ((x.encode_utf16().count() as i64) > (y.encode_utf16().count() as i64)) {\n        return x;\n    }\n    return y;\n}\n\nfn main() {\n    let s1 = \"short\";\n    let s2 = \"longer_string\";\n    let result = longest(s1, s2);\n    println!(\"{} {}\", \"最長字串為:\", result);\n}\n"
    }
  },
  {
    "id": "dim_unsafe",
    "title": "4-3. 系統底層不安全區塊 (unsafe(() => ...))",
    "category": "🛡️ 4. 系統底層與進階特性 (Systems & Advanced)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🛡️ 4-3. 系統底層不安全區塊 (unsafe(() => ...))\n// 透過 unsafe 閉包呼叫，轉換為 Rust 原生 unsafe { ... } 區塊\nfunction main() {\n  let secret = 999;\n  console.log(\"進入 unsafe 前數值:\", secret);\n\n  unsafe(() => {\n    console.log(\"【Unsafe 區塊內部】執行底層直接記憶體存取/FFI 邏輯:\", secret);\n  });\n\n  console.log(\"Unsafe 區塊執行完畢\");\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nfn main() {\n    let mut secret = 999;\n    println!(\"{} {}\", \"進入 unsafe 前數值:\", secret);\n    unsafe {\n        println!(\"{} {}\", \"【Unsafe 區塊內部】執行底層直接記憶體存取/FFI 邏輯:\", secret);\n    };\n    println!(\"{}\", \"Unsafe 區塊執行完畢\");\n}\n"
    }
  },
  {
    "id": "dim_traits",
    "title": "4-4. 特徵介面與多型 (interface & class implements)",
    "category": "🛡️ 4. 系統底層與進階特性 (Systems & Advanced)",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "// 🛡️ 4-4. 特徵介面與多型 (interface & class implements)\n// interface 自動轉換為 Rust 的 pub trait\ninterface Summary {\n  summarize(): string;\n}\n\n// class implements Summary 自動轉換為 impl Summary for Article\nclass Article implements Summary {\n  constructor(title, author) {\n    this.title = title;\n    this.author = author;\n  }\n\n  summarize() {\n    return `${this.title} by ${this.author}`;\n  }\n}\n\nfunction main() {\n  const article = new Article(\"Rust 系統程式設計\", \"Ferris\");\n  console.log(\"文章摘要:\", article.summarize());\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\npub trait Summary {\n    fn summarize(&self) -> String;\n}\n\n\n#[derive(Debug, Clone)]\npub struct Article {\n    pub title: String,\n    pub author: String,\n}\n\nimpl Article {\n    pub fn new(title: String, author: String) -> Self {\n        Self {\n            title,\n            author,\n        }\n    }\n\n    pub fn summarize(&self) -> String {\n        return format!(\"{} by {}\", self.title, self.author);\n    }\n}\n\nimpl Summary for Article {\n    fn summarize(&self) -> String {\n        return format!(\"{} by {}\", self.title, self.author);\n    }\n}\n\nfn main() {\n    let article = Article::new(\"Rust 系統程式設計\".to_string(), \"Ferris\".to_string());\n    println!(\"{} {:?}\", \"文章摘要:\", article.summarize());\n}\n"
    }
  },
  {
    "id": "custom",
    "title": "自訂空白專案 (Empty)",
    "category": "📝 其他",
    "folders": [
      "src"
    ],
    "files": {
      "src/main.js": "function main() {\n  console.log(\"Hello, World!\");\n}"
    },
    "projectFiles": {
      "Cargo.toml": "[package]\nname = \"js2rust_app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
      "src/main.rs": "#![allow(unused_imports, unused_variables, dead_code, non_snake_case)]\n\nfn main() {\n    println!(\"{}\", \"Hello, World!\");\n}\n"
    }
  }
];
