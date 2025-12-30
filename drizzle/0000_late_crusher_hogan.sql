CREATE TABLE "ceo_guidance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"responsibility" varchar(50) NOT NULL,
	"insight" text NOT NULL,
	"suggested_action" text NOT NULL,
	"priority" varchar(20) NOT NULL,
	"related_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_actioned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	"relevant_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_action" text,
	"related_value" varchar(100),
	"is_addressed" boolean DEFAULT false NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_values_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "conversation_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"channel_id" varchar(50) NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_activity" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegated_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direct_report_id" uuid NOT NULL,
	"instruction" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"conversation_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"ceo_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "direct_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slack_user_id" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"employment_agreement_doc_id" varchar(255),
	"alignment_conversation_doc_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "direct_reports_slack_user_id_unique" UNIQUE("slack_user_id")
);
--> statement-breakpoint
CREATE TABLE "financial_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"sheet_type" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "financial_sheets_sheet_id_unique" UNIQUE("sheet_id")
);
--> statement-breakpoint
CREATE TABLE "financial_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" varchar(255) NOT NULL,
	"sheet_name" varchar(255) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direct_report_id" uuid NOT NULL,
	"doc_type" varchar(50) NOT NULL,
	"google_doc_id" varchar(255) NOT NULL,
	"content" text,
	"last_synced" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bland_call_id" varchar(100) NOT NULL,
	"phone_number" varchar(50) NOT NULL,
	"recipient_name" varchar(255),
	"task" text NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"call_length" integer,
	"recording_url" varchar(500),
	"transcript" text,
	"summary" text,
	"analysis" jsonb,
	"error_message" text,
	"requested_by" varchar(50) NOT NULL,
	"slack_channel_id" varchar(50),
	"slack_thread_ts" varchar(50),
	"notified_ceo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "outbound_calls_bland_call_id_unique" UNIQUE("bland_call_id")
);
--> statement-breakpoint
CREATE TABLE "slack_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_id" varchar(100) NOT NULL,
	"channel_id" varchar(50) NOT NULL,
	"channel_name" varchar(255),
	"user_id" varchar(50) NOT NULL,
	"user_name" varchar(255),
	"text" text NOT NULL,
	"timestamp" varchar(50) NOT NULL,
	"thread_ts" varchar(50),
	"is_direct_message" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategic_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"parsed_sections" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delegated_tasks" ADD CONSTRAINT "delegated_tasks_direct_report_id_direct_reports_id_fk" FOREIGN KEY ("direct_report_id") REFERENCES "public"."direct_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_direct_report_id_direct_reports_id_fk" FOREIGN KEY ("direct_report_id") REFERENCES "public"."direct_reports"("id") ON DELETE no action ON UPDATE no action;