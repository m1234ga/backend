-- Create message_reactions table
CREATE TABLE IF NOT EXISTS message_reactions (
    id SERIAL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "participant" TEXT,
    "reaction" TEXT NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_reaction_per_user_message UNIQUE ("messageId", "participant")
);

-- Add foreign key constraint if messages table exists and it's safe (optional, but good practice if consistent)
-- We avoid strict FK for now if we are not sure about message retention or if messages can be deleted but reactions need to stay (unlikely), 
-- or if messages table creation order is not guaranteed in all setups (though it should be).
-- Given existing code, let's keep it simple. Accessing messages via FK is standard.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_message_reactions_message') THEN
        ALTER TABLE message_reactions
        ADD CONSTRAINT fk_message_reactions_message
        FOREIGN KEY ("messageId")
        REFERENCES messages(id)
        ON DELETE CASCADE;
    END IF;
END;
$$;
