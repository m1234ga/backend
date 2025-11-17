-- Add pushName column to messages table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS "pushName" TEXT;

-- Add comment to the column
COMMENT ON COLUMN messages."pushName" IS 'Display name of the message sender';
