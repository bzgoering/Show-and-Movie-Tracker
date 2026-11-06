import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'data/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'no-param-reassign': 'off', // the store hands out its data for in-place edits by design
    },
  },
  // Server, tests and tooling run in Node.
  { files: ['server/**/*.js', 'test/**/*.js', '*.config.js'], languageOptions: { globals: globals.node } },
  // Browser code. public/shared/ also runs on the server, so it gets no environment globals at all.
  { files: ['public/**/*.js'], ignores: ['public/shared/**'], languageOptions: { globals: globals.browser } },
];
