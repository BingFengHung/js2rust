/**
 * Sample JavaScript Algorithms to test js-to-rust
 */

/**
 * Recursive Fibonacci
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
 * Prime number check
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
 * Sum elements of an array
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

/**
 * Main entry point
 */
function main() {
  const fib10 = fibonacci(10);
  console.log("Fibonacci(10) =", fib10);

  const primeCheck = isPrime(29);
  console.log("Is 29 prime?", primeCheck);

  const numbers = [10, 20, 30, 40, 50];
  const total = sumArray(numbers);
  console.log("Sum of numbers =", total);
}
