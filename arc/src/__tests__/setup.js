// Vitest setup — global mocks for browser APIs not available in jsdom
import '@testing-library/jest-dom';

// Mock localStorage
const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};

// Mock sessionStorage
const sStore = {};
globalThis.sessionStorage = {
  getItem: (k) => sStore[k] ?? null,
  setItem: (k, v) => { sStore[k] = String(v); },
  removeItem: (k) => { delete sStore[k]; },
  clear: () => { Object.keys(sStore).forEach(k => delete sStore[k]); },
};

// Mock window.ethereum (MetaMask)
globalThis.window.ethereum = undefined;

// Mock fetch (returns empty by default, tests can override)
globalThis.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') })
);

// Mock Image for photo compression
globalThis.Image = class {
  constructor() { setTimeout(() => this.onload && this.onload(), 0); }
  set src(_) {}
};

// Mock canvas
HTMLCanvasElement.prototype.getContext = () => ({
  drawImage: () => {},
  fillRect: () => {},
});
HTMLCanvasElement.prototype.toBlob = function(cb) { cb(new Blob(['fake'], { type: 'image/jpeg' })); };

// Suppress console.error for expected React warnings during tests
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && (
    args[0].includes('act(') ||
    args[0].includes('ReactDOM.render') ||
    args[0].includes('not wrapped in act')
  )) return;
  originalError.call(console, ...args);
};
