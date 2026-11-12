ALTER TABLE "better_auth"."accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artifact_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."jwks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_access_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_client_assertions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_client_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "better_auth"."oauth_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "users_same_organization_select" ON "better_auth"."users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("better_auth"."users"."id" in (select user_id from public.members where organization_id = (select app.org_id())));--> statement-breakpoint
CREATE POLICY "artifact_versions_tenant_select" ON "artifact_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("artifact_versions"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "artifact_versions_tenant_insert" ON "artifact_versions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("artifact_versions"."organization_id" = (select app.org_id()) and exists (select 1 from public.artifacts a where a.id = "artifact_versions"."artifact_id" and (a.created_by = (select app.user_id()) or (select app.has_permission('artifact:update')))));--> statement-breakpoint
CREATE POLICY "artifacts_tenant_select" ON "artifacts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("artifacts"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "artifacts_tenant_insert" ON "artifacts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("artifacts"."organization_id" = (select app.org_id()) and (select app.has_permission('artifact:create')));--> statement-breakpoint
CREATE POLICY "artifacts_tenant_update" ON "artifacts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("artifacts"."organization_id" = (select app.org_id()) and ("artifacts"."created_by" = (select app.user_id()) or (select app.has_permission('artifact:update')))) WITH CHECK ("artifacts"."organization_id" = (select app.org_id()) and ("artifacts"."created_by" = (select app.user_id()) or (select app.has_permission('artifact:update'))));--> statement-breakpoint
CREATE POLICY "artifacts_tenant_delete" ON "artifacts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("artifacts"."organization_id" = (select app.org_id()) and ("artifacts"."created_by" = (select app.user_id()) or (select app.has_permission('artifact:delete'))));--> statement-breakpoint
CREATE POLICY "files_tenant_select" ON "files" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("files"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "files_tenant_insert" ON "files" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("files"."organization_id" = (select app.org_id()) and (select app.has_permission('file:upload')));--> statement-breakpoint
CREATE POLICY "files_tenant_update" ON "files" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("files"."organization_id" = (select app.org_id()) and ("files"."uploaded_by" = (select app.user_id()) or (select app.has_permission('file:update')))) WITH CHECK ("files"."organization_id" = (select app.org_id()) and ("files"."uploaded_by" = (select app.user_id()) or (select app.has_permission('file:update'))));--> statement-breakpoint
CREATE POLICY "files_tenant_delete" ON "files" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("files"."organization_id" = (select app.org_id()) and ("files"."uploaded_by" = (select app.user_id()) or (select app.has_permission('file:delete'))));--> statement-breakpoint
CREATE POLICY "invitations_tenant_select" ON "invitations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("invitations"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "invitations_tenant_update" ON "invitations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("invitations"."organization_id" = (select app.org_id()) and (select app.is_system())) WITH CHECK ("invitations"."organization_id" = (select app.org_id()) and (select app.is_system()));--> statement-breakpoint
CREATE POLICY "members_tenant_select" ON "members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("members"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "organization_roles_tenant_select" ON "organization_roles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("organization_roles"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "organizations_tenant_select" ON "organizations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("organizations"."id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "organizations_tenant_update" ON "organizations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("organizations"."id" = (select app.org_id())) WITH CHECK ("organizations"."id" = (select app.org_id()) and (select app.has_permission('billing:manage')));--> statement-breakpoint
CREATE POLICY "team_members_tenant_select" ON "team_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("team_members"."team_id" in (select id from public.teams where organization_id = (select app.org_id())));--> statement-breakpoint
CREATE POLICY "teams_tenant_select" ON "teams" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("teams"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "tasks_tenant_select" ON "tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("tasks"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "tasks_tenant_insert" ON "tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("tasks"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "tasks_tenant_update" ON "tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("tasks"."organization_id" = (select app.org_id()) and (select app.is_system())) WITH CHECK ("tasks"."organization_id" = (select app.org_id()) and (select app.is_system()));--> statement-breakpoint
CREATE POLICY "credit_ledger_tenant_select" ON "credit_ledger" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("credit_ledger"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "credit_ledger_tenant_insert" ON "credit_ledger" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("credit_ledger"."organization_id" = (select app.org_id()) and ("credit_ledger"."reason" = 'consumption' or (select app.is_system())));--> statement-breakpoint
CREATE POLICY "usage_levels_tenant_select" ON "usage_levels" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("usage_levels"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "usage_levels_tenant_insert" ON "usage_levels" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("usage_levels"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "usage_levels_tenant_update" ON "usage_levels" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("usage_levels"."organization_id" = (select app.org_id())) WITH CHECK ("usage_levels"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "workspaces_tenant_select" ON "workspaces" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("workspaces"."organization_id" = (select app.org_id()));--> statement-breakpoint
CREATE POLICY "workspaces_tenant_insert" ON "workspaces" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("workspaces"."organization_id" = (select app.org_id()) and (select app.has_permission('workspace:create')));--> statement-breakpoint
CREATE POLICY "workspaces_tenant_update" ON "workspaces" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("workspaces"."organization_id" = (select app.org_id()) and (select app.has_permission('workspace:update'))) WITH CHECK ("workspaces"."organization_id" = (select app.org_id()) and (select app.has_permission('workspace:update')));--> statement-breakpoint
CREATE POLICY "workspaces_tenant_delete" ON "workspaces" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("workspaces"."organization_id" = (select app.org_id()) and (select app.has_permission('workspace:delete')));