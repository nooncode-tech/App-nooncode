import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      '.tmp-*/**',
      '.vercel/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      'lib/server/supabase/database.types.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },
]

export default eslintConfig
