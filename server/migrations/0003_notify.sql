-- Согласие участника получать оповещения сообщениями в Telegram.
ALTER TABLE users ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
