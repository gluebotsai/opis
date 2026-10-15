-- Website visitors / opt-ins (campaign schema). Not CDP Audience contacts.
CREATE TABLE "website_contacts" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "contact_id" BIGINT,
    "email" TEXT,
    "phone" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "origin" TEXT NOT NULL DEFAULT '',
    "path" TEXT,
    "user_agent" TEXT,
    "subscribed" BOOLEAN NOT NULL DEFAULT false,
    "endpoint" TEXT,
    "auth_keys" JSONB,
    "platform" TEXT,
    "visit_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "website_contacts_tenant_id_visitor_id_key"
  ON "website_contacts"("tenant_id", "visitor_id");
CREATE INDEX "website_contacts_tenant_id_idx"
  ON "website_contacts"("tenant_id");
CREATE INDEX "website_contacts_tenant_id_contact_id_idx"
  ON "website_contacts"("tenant_id", "contact_id");
CREATE INDEX "website_contacts_tenant_id_email_idx"
  ON "website_contacts"("tenant_id", "email");
CREATE INDEX "website_contacts_tenant_id_subscribed_idx"
  ON "website_contacts"("tenant_id", "subscribed");
