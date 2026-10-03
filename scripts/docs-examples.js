export const examples = {
  arrays: {
    description: 'map 產生新陣列；reduce 累加結果，原陣列仍可使用。',
    javascript: `function main() {
  const numbers = [1, 2, 3];
  const doubled = numbers.map(value => value * 2);
  const total = doubled.reduce((sum, value) => sum + value, 0);
  console.log(doubled);
  console.log(total);
}`,
  },
  strings: {
    description: 'split 分割字串，再透過 map 與 join 組合新的結果。',
    javascript: `function main() {
  const words = "JavaScript,Rust,台灣".split(",");
  const result = words.map(word => word + "!").join(" / ");
  console.log(result);
}`,
  },
  splice: {
    description: 'splice 修改原陣列，同時回傳被移除的元素；負索引從尾端計算。',
    javascript: `function main() {
  const numbers = [1, 2, 3, 4];
  const removed = numbers.splice(-2, 1, 99, 100);
  console.log(removed);
  console.log(numbers);
}`,
  },
  numbers: {
    description: '保留括號與運算優先序；除法使用浮點數，floor 向負無限大取整。',
    javascript: `function main() {
  console.log((1 + 2) * 3);
  console.log(5 / 2);
  console.log(Math.floor(-1.5));
}`,
  },
};
