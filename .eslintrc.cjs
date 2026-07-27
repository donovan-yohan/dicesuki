module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'src/generated'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
  overrides: [
    {
      // Node ESM operator tooling. `@typescript-eslint/eslint-recommended` only
      // disables `no-undef` for TS extensions, so .mjs needs its own env and
      // module parser options. Linted via the `lint:admin` npm script.
      files: ['scripts/admin/**/*.mjs'],
      env: { node: true, es2022: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        TextEncoder: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  ],
}
