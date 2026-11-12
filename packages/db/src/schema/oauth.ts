import { boolean, index, integer, jsonb, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { betterAuthSchema, sessions, users } from './auth'
import { at } from './columns'
import { noAccess } from './policies'

export const jwks = betterAuthSchema
  .table(
    'jwks',
    {
      id: text('id').primaryKey(),
      publicKey: text('public_key').notNull(),
      privateKey: text('private_key').notNull(),
      createdAt: at('created_at').notNull(),
      expiresAt: at('expires_at'),
      alg: text('alg'),
      crv: text('crv'),
    },
    () => [noAccess('jwks')],
  )
  .enableRLS()

export const oauthClients = betterAuthSchema
  .table(
    'oauth_clients',
    {
      id: text('id').primaryKey(),
      clientId: text('client_id').notNull().unique('oauth_clients_client_id_unique'),
      clientSecret: text('client_secret'),
      clientDiscoveryId: text('client_discovery_id'),
      disabled: boolean('disabled').default(false),
      skipConsent: boolean('skip_consent'),
      enableEndSession: boolean('enable_end_session'),
      subjectType: text('subject_type'),
      scopes: text('scopes').array(),
      clientCredentialsScopes: text('client_credentials_scopes').array().default([]),
      userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
      createdAt: at('created_at'),
      updatedAt: at('updated_at'),
      name: text('name'),
      uri: text('uri'),
      icon: text('icon'),
      contacts: text('contacts').array(),
      tos: text('tos'),
      policy: text('policy'),
      softwareId: text('software_id'),
      softwareVersion: text('software_version'),
      softwareStatement: text('software_statement'),
      redirectUris: text('redirect_uris').array().notNull(),
      postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
      backchannelLogoutUri: text('backchannel_logout_uri'),
      backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
      tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
      applicationType: text('application_type'),
      jwks: text('jwks'),
      jwksUri: text('jwks_uri'),
      grantTypes: text('grant_types').array(),
      responseTypes: text('response_types').array(),
      requirePKCE: boolean('require_pkce'),
      dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
      referenceId: text('reference_id'),
      metadata: jsonb('metadata'),
    },
    (t) => [index('oauth_clients_user_id_idx').on(t.userId), noAccess('oauth_clients')],
  )
  .enableRLS()

export const oauthResources = betterAuthSchema
  .table(
    'oauth_resources',
    {
      id: text('id').primaryKey(),
      identifier: text('identifier').notNull().unique('oauth_resources_identifier_unique'),
      name: text('name').notNull(),
      accessTokenTtl: integer('access_token_ttl'),
      refreshTokenTtl: integer('refresh_token_ttl'),
      signingAlgorithm: text('signing_algorithm'),
      signingKeyId: text('signing_key_id'),
      allowedScopes: text('allowed_scopes').array(),
      customClaims: jsonb('custom_claims'),
      dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
      disabled: boolean('disabled').default(false),
      createdAt: at('created_at'),
      updatedAt: at('updated_at'),
      policyVersion: integer('policy_version').default(1),
      metadata: jsonb('metadata'),
    },
    () => [noAccess('oauth_resources')],
  )
  .enableRLS()

export const oauthClientResources = betterAuthSchema
  .table(
    'oauth_client_resources',
    {
      id: text('id').primaryKey(),
      clientId: text('client_id')
        .notNull()
        .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
      resourceId: text('resource_id')
        .notNull()
        .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
      metadata: jsonb('metadata'),
      createdAt: at('created_at'),
    },
    (t) => [
      uniqueIndex('oauth_client_resources_client_id_resource_id_unique').on(
        t.clientId,
        t.resourceId,
      ),
      index('oauth_client_resources_client_id_idx').on(t.clientId),
      index('oauth_client_resources_resource_id_idx').on(t.resourceId),
      noAccess('oauth_client_resources'),
    ],
  )
  .enableRLS()

export const oauthRefreshTokens = betterAuthSchema
  .table(
    'oauth_refresh_tokens',
    {
      id: text('id').primaryKey(),
      token: text('token').notNull().unique('oauth_refresh_tokens_token_unique'),
      clientId: text('client_id')
        .notNull()
        .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
      sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
      userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      referenceId: text('reference_id'),
      authorizationCodeId: text('authorization_code_id'),
      resources: text('resources').array(),
      requestedUserInfoClaims: text('requested_user_info_claims').array(),
      expiresAt: at('expires_at'),
      createdAt: at('created_at'),
      revoked: at('revoked'),
      rotatedAt: at('rotated_at'),
      rotationReplayResponse: text('rotation_replay_response'),
      rotationReplayExpiresAt: at('rotation_replay_expires_at'),
      authTime: at('auth_time'),
      confirmation: jsonb('confirmation'),
      scopes: text('scopes').array().notNull(),
    },
    (t) => [
      index('oauth_refresh_tokens_client_id_idx').on(t.clientId),
      index('oauth_refresh_tokens_session_id_idx').on(t.sessionId),
      index('oauth_refresh_tokens_user_id_idx').on(t.userId),
      index('oauth_refresh_tokens_authorization_code_id_idx').on(t.authorizationCodeId),
      noAccess('oauth_refresh_tokens'),
    ],
  )
  .enableRLS()

export const oauthAccessTokens = betterAuthSchema
  .table(
    'oauth_access_tokens',
    {
      id: text('id').primaryKey(),
      token: text('token').unique('oauth_access_tokens_token_unique'),
      clientId: text('client_id')
        .notNull()
        .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
      sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
      userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
      referenceId: text('reference_id'),
      authorizationCodeId: text('authorization_code_id'),
      resources: text('resources').array(),
      requestedUserInfoClaims: text('requested_user_info_claims').array(),
      refreshId: text('refresh_id').references(() => oauthRefreshTokens.id, {
        onDelete: 'cascade',
      }),
      expiresAt: at('expires_at'),
      createdAt: at('created_at'),
      revoked: at('revoked'),
      confirmation: jsonb('confirmation'),
      scopes: text('scopes').array().notNull(),
    },
    (t) => [
      index('oauth_access_tokens_client_id_idx').on(t.clientId),
      index('oauth_access_tokens_session_id_idx').on(t.sessionId),
      index('oauth_access_tokens_user_id_idx').on(t.userId),
      index('oauth_access_tokens_authorization_code_id_idx').on(t.authorizationCodeId),
      index('oauth_access_tokens_refresh_id_idx').on(t.refreshId),
      noAccess('oauth_access_tokens'),
    ],
  )
  .enableRLS()

export const oauthConsents = betterAuthSchema
  .table(
    'oauth_consents',
    {
      id: text('id').primaryKey(),
      clientId: text('client_id')
        .notNull()
        .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
      userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
      referenceId: text('reference_id'),
      resources: text('resources').array(),
      requestedUserInfoClaims: text('requested_user_info_claims').array(),
      scopes: text('scopes').array().notNull(),
      createdAt: at('created_at'),
      updatedAt: at('updated_at'),
    },
    (t) => [
      index('oauth_consents_client_id_idx').on(t.clientId),
      index('oauth_consents_user_id_idx').on(t.userId),
      noAccess('oauth_consents'),
    ],
  )
  .enableRLS()

export const oauthClientAssertions = betterAuthSchema
  .table(
    'oauth_client_assertions',
    {
      id: text('id').primaryKey(),
      expiresAt: at('expires_at').notNull(),
    },
    () => [noAccess('oauth_client_assertions')],
  )
  .enableRLS()
