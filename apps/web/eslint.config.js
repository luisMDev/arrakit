import { react } from '@arrakit/eslint-config'

export default [
  ...react({
    restrictedPaths: [{ name: 'sonner', message: "Show toasts with notify from '#/lib/notify'." }],
    restrictedPathsAllowedIn: ['src/lib/notify.ts'],
  }),
  {
    // shadcn/ui components are generated; keep them as shadcn ships them.
    ignores: ['src/components/ui/**', 'src/hooks/use-mobile.ts'],
  },
]
