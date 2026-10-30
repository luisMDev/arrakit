ALTER TABLE "sessions" DROP CONSTRAINT "sessions_active_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "active_organization_id";