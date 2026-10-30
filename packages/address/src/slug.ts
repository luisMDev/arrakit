export const MAX_SLUG_LENGTH = 63

export const slugOf = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')

export const slugCandidates = (name: string): string[] => {
  const base = slugOf(name)
  if (base === '') return []
  const numbered = Array.from({ length: 49 }, (_, i) => {
    const suffix = `-${i + 2}`
    return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
  })
  return [base, ...numbered]
}
