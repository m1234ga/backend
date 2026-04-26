-- Create message_edits table to keep full message edit history
CREATE TABLE IF NOT EXISTS message_edits (
  id BIGSERIAL PRIMARY KEY,
  "messageId" VARCHAR(50) NOT NULL,
  "oldMessage" TEXT NOT NULL,
  "newMessage" TEXT NOT NULL,
  "editedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_message_edits_message
    FOREIGN KEY ("messageId") REFERENCES messages(id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_message_edits_message_id
  ON message_edits ("messageId");

CREATE INDEX IF NOT EXISTS idx_message_edits_edited_at
  ON message_edits ("editedAt");
