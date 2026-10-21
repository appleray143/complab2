CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  pc_number TEXT NOT NULL UNIQUE,
  computer_name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  last_seen TEXT,
  usage_minutes_today INTEGER NOT NULL DEFAULT 0,
  allowance_minutes INTEGER NOT NULL DEFAULT 60,
  blocked INTEGER NOT NULL DEFAULT 0,
  recent_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  usage_day TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK(sender IN ('admin', 'client')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_pc_number ON devices(pc_number);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_chat_device_time ON chat_messages(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_pending ON chat_messages(device_id, sender, delivered_at);
