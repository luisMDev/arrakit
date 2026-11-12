CREATE INDEX "sessions_active_organization_id_idx" ON "better_auth"."sessions" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "sessions_active_team_id_idx" ON "better_auth"."sessions" USING btree ("active_team_id");--> statement-breakpoint
CREATE INDEX "artifact_versions_organization_id_index" ON "artifact_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "artifact_versions_published_by_index" ON "artifact_versions" USING btree ("published_by");--> statement-breakpoint
CREATE INDEX "artifacts_workspace_id_index" ON "artifacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "artifacts_created_by_index" ON "artifacts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "files_workspace_id_index" ON "files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "files_uploaded_by_index" ON "files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "invitations_inviter_id_idx" ON "invitations" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_id_index" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_requested_by_index" ON "tasks" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "workspaces_created_by_index" ON "workspaces" USING btree ("created_by");--> statement-breakpoint
CREATE POLICY "accounts_no_access" ON "better_auth"."accounts" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "sessions_no_access" ON "better_auth"."sessions" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "verifications_no_access" ON "better_auth"."verifications" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "jwks_no_access" ON "better_auth"."jwks" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_access_tokens_no_access" ON "better_auth"."oauth_access_tokens" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_client_assertions_no_access" ON "better_auth"."oauth_client_assertions" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_client_resources_no_access" ON "better_auth"."oauth_client_resources" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_clients_no_access" ON "better_auth"."oauth_clients" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_consents_no_access" ON "better_auth"."oauth_consents" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_refresh_tokens_no_access" ON "better_auth"."oauth_refresh_tokens" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "oauth_resources_no_access" ON "better_auth"."oauth_resources" AS RESTRICTIVE FOR ALL TO public USING (false) WITH CHECK (false);