-- Add missing indexes for GetChatsPage query performance
CREATE INDEX IF NOT EXISTS idx_chats_lastmessagetime ON chats("lastMessageTime" DESC);
CREATE INDEX IF NOT EXISTS idx_chats_assigned_to ON chats("assignedTo");
CREATE INDEX IF NOT EXISTS idx_chats_status_and_time ON chats(status, "lastMessageTime" DESC);
CREATE INDEX IF NOT EXISTS idx_chatTags_chatid ON "chatTags"("chatId");
CREATE INDEX IF NOT EXISTS idx_tags_tagid ON tags("tagId");
CREATE INDEX IF NOT EXISTS idx_lid_mappings_lid ON lid_mappings(lid);
CREATE INDEX IF NOT EXISTS idx_messages_chatid_timestamp ON messages("chatId", "timeStamp" DESC);
