// Flat config: mainly `no-undef` (typo/missing-reference detection) across the
// browser client, the Node server and the tests.
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', console: 'readonly', requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly', performance: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  WebSocket: 'readonly', AudioContext: 'readonly', webkitAudioContext: 'readonly',
  structuredClone: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', Image: 'readonly',
  fetch: 'readonly', alert: 'readonly', devicePixelRatio: 'readonly',
  Float32Array: 'readonly', Uint8Array: 'readonly', TextEncoder: 'readonly'
};

const nodeGlobals = {
  process: 'readonly', Buffer: 'readonly', console: 'readonly', URL: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', TextEncoder: 'readonly', performance: 'readonly',
  fetch: 'readonly', structuredClone: 'readonly', WebSocket: 'readonly'
};

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'katt-runner/**', '.data/**'] },
  {
    files: ['js/client/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browserGlobals },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'getter-return': 'error',
      'no-self-assign': 'error'
    }
  },
  {
    files: ['js/shared/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...browserGlobals, ...nodeGlobals } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error'
    }
  },
  {
    // Tests run in Node but drive browser code inside page.evaluate(), so both
    // sets of globals are legitimate here.
    files: ['server/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...nodeGlobals, ...browserGlobals } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-const-assign': 'error',
      'no-dupe-keys': 'error'
    }
  }
];
