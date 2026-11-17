-- Ежедневное напоминание участнику, что в его списках есть некупленные товары.
ALTER TABLE users ADD COLUMN remind INTEGER NOT NULL DEFAULT 0;
-- Местное время напоминания «ЧЧ:ММ» и дни недели битами: Пн = 1, Вт = 2, … Вс = 64.
ALTER TABLE users ADD COLUMN remind_time TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE users ADD COLUMN remind_days INTEGER NOT NULL DEFAULT 127;
-- Часовой пояс участника (IANA, из браузера) и местная дата последнего напоминания.
ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE users ADD COLUMN reminded_on TEXT;
