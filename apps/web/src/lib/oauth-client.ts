import { createArrakitOAuthClient } from '@arrakit/auth/client'

/** Only for the connector screens (/oauth/*): it signs every POST with the page's OAuth query. */
export const oauthClient = createArrakitOAuthClient()
