-- Add status column to chats table
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS status VARCHAR(10) DEFAULT 'open';

-- Add check constraint to ensure only valid status values
ALTER TABLE chats 
ADD CONSTRAINT chats_status_check CHECK (status IN ('open', 'closed'));

-- Add close_reason column to store the reason for closing
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- Add closed_at column to track when the chat was closed
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
CREATE INDEX IF NOT EXISTS idx_chats_closed_at ON chats(closed_at);

-- Update existing chats to have 'open' status if NULL
UPDATE chats 
SET status = 'open' 
WHERE status IS NULL;

-- Add comments to document the columns
COMMENT ON COLUMN chats.status IS 'Chat status: open or closed';
COMMENT ON COLUMN chats.close_reason IS 'Reason provided when closing the chat';
COMMENT ON COLUMN chats.closed_at IS 'Timestamp when the chat was closed';

