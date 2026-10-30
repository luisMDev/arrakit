import { react } from '@arrakit/eslint-config'

export default [
  ...react(),
  {
    // shadcn/ui components are generated; keep them as shadcn ships them.
    ignores: ['src/components/ui/**', 'src/hooks/use-mobile.ts'],
  },
]
