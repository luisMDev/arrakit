Qué haría, por prioridad

1. Limpiar la herencia de saas-base: reescribir AGENTS.md (hoy se presenta como clon de saas-base) y escribir la documentación del producto, porque las specs y docs/gaps se han borrado. Añadir un script init que renombre scope, marca, prefijos y los textos que aún llevan "Arrakit" literal.
2. Un módulo de ejemplo "projects" completo, que fije el patrón canónico: schema, su scope en forOrganization() (o un guard genérico de tenancy), contrato, router, tool MCP, pantalla con react-hook-form, entrada en una sidebar extensible y tests.
3. Separar como opcionales los créditos, el storage+jobs, MCP/OAuth y billing. Quitar el CHECK de planes del SQL.

Producción

- No hay rate limiting compartido entre instancias (Better Auth no configura rateLimit ni secondaryStorage), ni audit log. La web no tiene una CSP completa (sin script-src/connect-src; necesitaría nonces en TanStack Start y probarla con Stripe).
- Tampoco existen panel de admin, API keys para clientes, datos de seed ni exportación de datos (RGPD).

Frontend

- La landing tiene el copy escrito en apps/landing/src/pages/index.astro (aún con textos de relleno) y no comparte tema con la web.
- El shell no tiene navegación extensible: los enlaces están fijos en apps/web/src/components/shell/app-menu.tsx:42-63. Los componentes sidebar y sheet están instalados pero sin usar, y no hay navegación móvil.

Arrancar un producto nuevo

- No hay script de renombrado. "arrakit" aparece 409 veces en 167 ficheros (fuera de docs/).
- Algunas apariciones no son solo cosméticas. COOKIE_PREFIX='arrakit' (packages/auth/src/config.ts:7) es el prefijo de las cookies de sesión. PRICE_KEY_PREFIX='arrakit_' (apps/api/src/billing/subscription-plan.ts:21) es la clave con la que se buscan los precios en Stripe: si se cambia después de crearlos, deja de encontrarlos.
- Casi todos los textos de i18n interpolan {{appName}}, pero quedan 6 "Arrakit" literales en roles.json y shell.json (en y es).
- AGENTS.md empieza con "clone of saas-base at /home/luismdev/…". "saas-base" aparece 10 veces fuera de docs/: 7 en AGENTS.md y 3 en apps/ (comentarios en plans-page.tsx, api-proxy-handler.ts y styles.css).
- Los documentos de migración (docs/gaps/, docs/ownership.md y docs/spec/) se borran en este cambio; falta documentación del producto que los sustituya.

Lo más relevante del backend:

- Tenancy por convención: no hay guard genérico. forOrganization() (packages/db/src/organization/index.ts:31) expone métodos a mano por dominio, y el aislamiento entre organizaciones depende de que cada consulta lleve bien su filtro por organizationId.
- Módulo nuevo = muchos sitios que tocar (schema, scope, contrato, router, pantalla, i18n, tests), entre ellos las herramientas MCP escritas a mano (apps/api/src/mcp/server.ts).
- Piezas de producto acopladas:
  - El sistema de créditos se mete en el contrato base de todos los procedimientos: el error PAYMENT_REQUIRED con su metric en packages/contract/src/common.ts:28.
  - El número de asientos del plan se mete en la gestión de miembros (packages/auth/src/organization.ts:54 y 113-118).
  - Los planes están fijados con un CHECK en SQL (organizations_plan_check en packages/db/src/schema/organizations.ts:24), así que cambiarlos exige una migración.
- Infraestructura sin uso real: unas 156 líneas de almacenamiento de ficheros (packages/db/src/storage, sin tests) que ningún endpoint usa para subir o leer; solo las usa el worker de purga al borrar una organización.
- Difícil de quitar: créditos, MCP/OAuth (apps/api/src/main.ts monta siempre mcpHandler, no se puede desactivar con configuración) y, sobre todo, el modo multi-organización.
