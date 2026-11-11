CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"label" text,
	"requested_by" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer,
	"error_code" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "tasks_attempts_check" CHECK ("tasks"."attempts" >= 0 and "tasks"."max_attempts" >= 1),
	CONSTRAINT "tasks_progress_check" CHECK ("tasks"."progress_done" >= 0 and ("tasks"."progress_total" is null or "tasks"."progress_done" <= "tasks"."progress_total")),
	CONSTRAINT "tasks_subject_check" CHECK (("tasks"."subject_type" is null) = ("tasks"."subject_id" is null))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_organization_id_created_at_index" ON "tasks" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "tasks_active_updated_at_index" ON "tasks" USING btree ("updated_at") WHERE "tasks"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "tasks_finished_at_index" ON "tasks" USING btree ("finished_at") WHERE "tasks"."status" in ('succeeded', 'failed');