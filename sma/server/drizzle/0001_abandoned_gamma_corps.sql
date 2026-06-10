CREATE TABLE "org_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"anthropic_org_id" text,
	"allowed_email_domain" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"anthropic_workspace_id" text,
	"anthropic_api_key_encrypted" text NOT NULL,
	"executive_name" text NOT NULL,
	"display_name" text NOT NULL,
	"default_environment_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
