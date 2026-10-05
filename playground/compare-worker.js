importScripts('./comparison-values.js');
const { encodeValue } = JS2RUST_COMPARISON;
// No network is needed for JavaScript execution. Validation rejects browser APIs.
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}
self.onmessage = ({ data }) => {
  const results = data.cases.map(args => {
    const logs = [];
    try {
      const value = new Function('args', 'console', data.javascript)(args, Object.freeze({ log: (...values) => logs.push(values.map(v => encodeValue(v))) }));
      return { value: encodeValue(value), logs };
    } catch (error) { return { error: error.message, logs }; }
  });
  self.postMessage(results);
};
