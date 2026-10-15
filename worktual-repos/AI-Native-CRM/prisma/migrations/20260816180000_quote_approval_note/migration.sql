-- Finance approve/reject reason on quotes (reject requires a note).
ALTER TABLE "quotes" ADD COLUMN "approval_note" TEXT;
