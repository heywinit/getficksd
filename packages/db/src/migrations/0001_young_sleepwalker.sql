CREATE TABLE "stored_file" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"object_key" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_at" timestamp,
	CONSTRAINT "stored_file_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storedFile_organizationId_idx" ON "stored_file" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "storedFile_uploadedBy_idx" ON "stored_file" USING btree ("uploaded_by");