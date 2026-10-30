import { base } from '@arrakit/eslint-config'

// packages/db is the only workspace allowed to import data drivers.
export default base({ restrictData: false })
