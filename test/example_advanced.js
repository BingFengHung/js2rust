/**
 * Advanced JavaScript to Rust features test
 */

/**
 * 2D Point structure
 * @typedef {Object} Point
 * @property {float} x
 * @property {float} y
 */

/**
 * Calculates distance of Point from origin
 * @param {Point} p
 * @returns {float}
 */
function distanceFromOrigin(p) {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

/**
 * In-place mutation test: resets the first element to zero
 * (js-to-rust will automatically detect mutation and generate &mut [i64]!)
 * @param {int[]} arr
 */
function resetFirst(arr) {
  arr[0] = 0;
}

/**
 * Switch/Case to Rust Match pattern matching
 * @param {int} code
 * @returns {string}
 */
function getStatus(code) {
  switch (code) {
    case 200:
      return "OK";
    case 404:
      return "Not Found";
    case 500:
      return "Server Error";
    default:
      return "Unknown";
  }
}

/**
 * Main function demonstrating Structs, Match, &mut Auto-Borrow, and Template Literals
 */
function main() {
  // 1. Struct creation & usage
  const pt = { x: 3.0, y: 4.0 };
  const dist = distanceFromOrigin(pt);
  console.log("Distance from origin =", dist);

  // 2. Pattern Matching via switch
  const statusMsg = getStatus(200);
  console.log("Status message =", statusMsg);

  // 3. Auto &mut Borrowing test
  let numbers = [100, 200, 300];
  resetFirst(numbers); // Automatically becomes resetFirst(&mut numbers)!
  console.log("After resetFirst =", numbers);

  // 4. Vector push & includes
  numbers.push(400);
  const contains400 = numbers.includes(400);
  console.log("Contains 400?", contains400);

  // 5. Template Literals & Ternary Operator
  const score = 85;
  const grade = score >= 60 ? "PASS" : "FAIL";
  const report = `Student Score: ${score}, Result: ${grade}`;
  console.log(report);
}
