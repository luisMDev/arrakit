import { react } from '@arrakit/eslint-config'

export default [
  ...react({
    restrictedPaths: [
      {
        name: 'sonner',
        message: "Show toasts with notify from '#/lib/notify'.",
        allowedIn: ['src/lib/notify.ts'],
      },
      {
        name: '@supabase/supabase-js',
        message: "Join Realtime channels with joinChannel from '#/lib/realtime'.",
        allowedIn: ['src/lib/realtime.ts'],
      },
      {
        name: '@arrakit/db',
        message: 'The web never talks to the database; it only calls /api/*.',
      },
    ],
  }),
  {
    // shadcn/ui components are generated; keep them as shadcn ships them.
    ignores: ['src/components/ui/**', 'src/hooks/use-mobile.ts'],
  },
]
