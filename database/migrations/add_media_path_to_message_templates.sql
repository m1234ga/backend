-- Add mediaPath column to messageTemplates table
-- This column stores the file path for audio, images, and videos associated with templates
-- Note: Table name is quoted to preserve case sensitivity
ALTER TABLE "messageTemplates" 
ADD COLUMN IF NOT EXISTS "mediaPath" TEXT;

-- Add comment to the column
COMMENT ON COLUMN "messageTemplates"."mediaPath" IS 'File path for media files (audio, images, videos) associated with the template';

-- Note: If imagePath column already exists, you can migrate data or keep both columns
-- For backward compatibility, keeping imagePath but mediaPath is the preferred field going forward


