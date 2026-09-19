-- B1: Add params JSONB column to messages table for i18n event-based chat
-- Run in Supabase Dashboard → SQL Editor
ALTER TABLE messages ADD COLUMN IF NOT EXISTS params JSONB DEFAULT NULL;
