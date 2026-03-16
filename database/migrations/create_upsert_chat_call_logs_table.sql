CREATE TABLE IF NOT EXISTS upsert_chat_call_logs (
  id BIGSERIAL PRIMARY KEY,
  function_name VARCHAR(100) NOT NULL,
  chat_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upsert_chat_call_logs_chat_id
  ON upsert_chat_call_logs(chat_id);

CREATE INDEX IF NOT EXISTS idx_upsert_chat_call_logs_created_at
  ON upsert_chat_call_logs(created_at);
