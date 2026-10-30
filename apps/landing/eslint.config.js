import { base } from '@arrakit/eslint-config'

export default [...base(), { ignores: ['**/*.astro', '.astro/**'] }]
