-- Create chat_status_details table to track status changes
CREATE TABLE IF NOT EXISTS chat_status_details (
  id SERIAL PRIMARY KEY,
  chat_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL,
  changed_by VARCHAR(255),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  notes TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chat_status_details_chat_id ON chat_status_details(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_status_details_status ON chat_status_details(status);
CREATE INDEX IF NOT EXISTS idx_chat_status_details_changed_at ON chat_status_details(changed_at);

-- Add comments
COMMENT ON TABLE chat_status_details IS 'Tracks all status changes for chats including open, closed, processing, etc.';
COMMENT ON COLUMN chat_status_details.chat_id IS 'Reference to the chat';
COMMENT ON COLUMN chat_status_details.status IS 'Status: open, closed, processing, pending, unassigned, follow_up, resolved';
COMMENT ON COLUMN chat_status_details.changed_by IS 'User who changed the status';
COMMENT ON COLUMN chat_status_details.changed_at IS 'When the status was changed';
COMMENT ON COLUMN chat_status_details.reason IS 'Reason for status change (especially for closing)';
COMMENT ON COLUMN chat_status_details.notes IS 'Additional notes about the status change';

-- Insert initial status records for existing chats
INSERT INTO chat_status_details (chat_id, status, changed_at)
SELECT 
  id, 
  COALESCE(status, 'open'), 
  COALESCE("lastMessageTime", CURRENT_TIMESTAMP)
FROM chats
WHERE id NOT IN (SELECT DISTINCT chat_id FROM chat_status_details);

-- Update chats table to remove closed_at column since we'll use chat_status_details
-- ALTER TABLE chats DROP COLUMN IF EXISTS closed_at;
