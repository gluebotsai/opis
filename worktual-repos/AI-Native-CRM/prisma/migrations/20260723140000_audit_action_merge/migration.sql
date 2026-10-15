-- Allow contact merge audits.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'merge';
