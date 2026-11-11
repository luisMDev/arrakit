import type { Artifact } from '@arrakit/contract'

import { useMember } from '#/lib/current-user'

/** What the person may do to `artifact`: its creator always changes it, others need the role. */
export function useArtifactActions(artifact: Artifact) {
  const me = useMember()
  return {
    canChange: artifact.createdByYou || me.can({ artifact: ['update'] }),
    canDelete: artifact.createdByYou || me.can({ artifact: ['delete'] }),
  }
}
