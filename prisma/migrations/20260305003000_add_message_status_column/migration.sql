ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'sent';

UPDATE "messages"
SET "status" = CASE
  WHEN COALESCE("isRead", false) = true THEN 'read'
  WHEN COALESCE("isDelivered", false) = true THEN 'delivered'
  WHEN COALESCE("isFromMe", false) = true THEN 'sent'
  ELSE 'read'
END
WHERE "status" IS NULL;
