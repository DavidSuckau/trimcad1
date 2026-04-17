import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Geometrie/Store nutzen Hilfsfunktionen mit Präfix "use*" (keine React-Hooks).
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.tsx'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  // Canvas ruft dieselben Hilfsfunktionen in Handlern/Closures auf (keine Hook-Semantik).
  {
    files: ['src/components/WorkspaceCanvas.tsx'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
)
