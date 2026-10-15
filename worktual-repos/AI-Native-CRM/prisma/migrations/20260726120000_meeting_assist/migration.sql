-- CreateEnum
CREATE TYPE "meeting_assist_status" AS ENUM ('active', 'ended', 'failed');

-- CreateEnum
CREATE TYPE "meeting_assist_provider" AS ENUM ('google_meet', 'zoom', 'teams', 'other');

-- CreateTable
CREATE TABLE "meeting_assist_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "contact_id" UUID NOT NULL,
    "activity_id" TEXT NOT NULL,
    "provider" "meeting_assist_provider" NOT NULL DEFAULT 'other',
    "external_meeting_id" TEXT,
    "join_url" TEXT,
    "host_user_id" UUID,
    "status" "meeting_assist_status" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "last_assist_at" TIMESTAMP(3),
    "last_suggestions" JSONB,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_assist_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_transcript_chunks" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "speaker" TEXT,
    "text" TEXT NOT NULL,
    "spoken_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'live_push',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_transcript_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_assist_sessions_activity_id_key" ON "meeting_assist_sessions"("activity_id");

-- CreateIndex
CREATE INDEX "meeting_assist_sessions_organization_id_contact_id_status_idx" ON "meeting_assist_sessions"("organization_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "meeting_assist_sessions_organization_id_status_started_at_idx" ON "meeting_assist_sessions"("organization_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "meeting_assist_sessions_external_meeting_id_idx" ON "meeting_assist_sessions"("external_meeting_id");

-- CreateIndex
CREATE INDEX "meeting_transcript_chunks_session_id_created_at_idx" ON "meeting_transcript_chunks"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_transcript_chunks_session_id_seq_key" ON "meeting_transcript_chunks"("session_id", "seq");

-- AddForeignKey
ALTER TABLE "meeting_transcript_chunks" ADD CONSTRAINT "meeting_transcript_chunks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "meeting_assist_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
