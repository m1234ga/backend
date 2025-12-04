-- Add mediaPath column to messages table
-- This column stores the file path for audio, images, and videos
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS "mediaPath" TEXT;

-- Add comment to the column
COMMENT ON COLUMN messages."mediaPath" IS 'File path for media messages (audio, images, videos)';



















