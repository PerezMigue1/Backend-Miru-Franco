// Configuración de ESLint 8 (formato clásico) para el backend.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true,
  },
  // dist y node_modules son artefactos; scripts/ son utilidades de una sola vez
  // (migraciones y altas manuales) que no pasan por el lint del código de producción.
  ignorePatterns: ['dist', 'node_modules', 'scripts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    // Los sanitizadores del proyecto eliminan caracteres de control a propósito
    // (p. ej. limpiar entradas antes de guardarlas), así que las regex con
    // rangos como \x00-\x1f son intencionales y no un error.
    'no-control-regex': 'off',
  },
  overrides: [
    {
      // En specs se permite require() (mocks y carga diferida en pruebas).
      files: ['**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
