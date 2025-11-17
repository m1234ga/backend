-- Create messageTemplates table if it doesn't exist
CREATE TABLE IF NOT EXISTS "messageTemplates" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  createdBy VARCHAR(255) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "imagePath" TEXT,
  "mediaPath" TEXT
);

-- Add comment to the table
COMMENT ON TABLE "messageTemplates" IS 'Message templates for quick replies';

-- Add comments to columns
COMMENT ON COLUMN "messageTemplates"."imagePath" IS 'File path for image files (backward compatibility)';
COMMENT ON COLUMN "messageTemplates"."mediaPath" IS 'File path for media files (audio, images, videos) associated with the template';


