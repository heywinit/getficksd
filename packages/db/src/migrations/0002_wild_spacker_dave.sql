CREATE TABLE "dataset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"source_file_id" text,
	"name" text NOT NULL,
	"columns" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_row" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"errors" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset" ADD CONSTRAINT "dataset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset" ADD CONSTRAINT "dataset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset" ADD CONSTRAINT "dataset_source_file_id_stored_file_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."stored_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_row" ADD CONSTRAINT "dataset_row_dataset_id_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."dataset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_organizationId_idx" ON "dataset" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dataset_createdBy_idx" ON "dataset" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "datasetRow_datasetId_idx" ON "dataset_row" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "datasetRow_datasetId_rowNumber_uidx" ON "dataset_row" USING btree ("dataset_id","row_number");