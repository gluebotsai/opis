-- Align calendar_meet_captures.status with Prisma CalendarMeetCaptureStatus enum.
DO $$ BEGIN
  CREATE TYPE "crm"."CalendarMeetCaptureStatus" AS ENUM (
    'pending',
    'dispatched',
    'cancelled',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE crm.calendar_meet_captures
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE crm.calendar_meet_captures
  ALTER COLUMN status TYPE "crm"."CalendarMeetCaptureStatus"
  USING (
    CASE lower(trim(status::text))
      WHEN 'pending' THEN 'pending'::"crm"."CalendarMeetCaptureStatus"
      WHEN 'dispatched' THEN 'dispatched'::"crm"."CalendarMeetCaptureStatus"
      WHEN 'cancelled' THEN 'cancelled'::"crm"."CalendarMeetCaptureStatus"
      WHEN 'failed' THEN 'failed'::"crm"."CalendarMeetCaptureStatus"
      ELSE 'pending'::"crm"."CalendarMeetCaptureStatus"
    END
  );

ALTER TABLE crm.calendar_meet_captures
  ALTER COLUMN status SET DEFAULT 'pending'::"crm"."CalendarMeetCaptureStatus";
