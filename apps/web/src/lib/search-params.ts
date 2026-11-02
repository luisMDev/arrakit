import { z } from 'zod'

/**
 * A search param read as text (the router parses `?x=1` as a number); anything else, null
 * included, is dropped.
 */
export const searchText = z
  .union([z.string(), z.number().transform(String)])
  .optional()
  .catch(undefined)
