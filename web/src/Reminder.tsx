import { useState } from "react";
import { api, type Reminder } from "./api";
import { haptic, requestWriteAccess } from "./telegram";

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const ALL_DAYS = 127;
const WORKDAYS = 31;
const WEEKEND = 96;

export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Подпись для чипа: «⏰ 18:00», «⏰ 18:00 · по будням», «⏰ 18:00 · Сб». */
export function reminderChip(time: string, days: number): string {
  const picked = DAYS.filter((_, i) => days & (1 << i));
  const when =
    days === ALL_DAYS
      ? ""
      : days === WORKDAYS
        ? " · по будням"
        : days === WEEKEND
          ? " · по выходным"
          : picked.length <= 2
            ? ` · ${picked.join(", ")}`
            : ` · ${picked.length} дн. в неделю`;
  return `⏰ ${time}${when}`;
}

/** Карточка настройки ежедневного напоминания об активных списках. */
export function ReminderCard({ value, onChange }: { value: Reminder; onChange: (r: Reminder) => void }) {
  const [enabled, setEnabled] = useState(value.enabled);
  const [time, setTime] = useState(value.time);
  const [days, setDays] = useState(value.days);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const timezone = browserTimezone() ?? value.timezone;
  const dirty =
    enabled !== value.enabled || time !== value.time || days !== value.days || (enabled && timezone !== value.timezone);

  function toggleDay(i: number) {
    haptic();
    const next = days ^ (1 << i);
    if (next) setDays(next); // хотя бы один день должен остаться
    setSaved(false);
  }

  async function save() {
    setError(null);
    if (enabled && !value.enabled && !(await requestWriteAccess())) {
      setError("Без разрешения писать вам бот не сможет прислать напоминание.");
      return;
    }
    setSaving(true);
    try {
      const next = await api.setReminder({ enabled, time, days, timezone });
      onChange(next);
      setSaved(true);
      haptic();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card reminder">
      <div className="card-head">
        <strong id="reminder-title">Напоминание о покупках</strong>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            aria-labelledby="reminder-title"
            onChange={(e) => {
              haptic();
              setEnabled(e.target.checked);
              setSaved(false);
            }}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      <p className="hint small">
        Бот пришлёт сообщение в выбранное время, если в ваших списках есть некупленные товары. Когда всё куплено, он
        промолчит.
      </p>

      <fieldset className="reminder-body" disabled={!enabled}>
        <label className="field raised time">
          <input
            type="time"
            value={time}
            required
            onChange={(e) => {
              if (e.target.value) setTime(e.target.value);
              setSaved(false);
            }}
          />
          <span>Время</span>
        </label>
        <div className="days" role="group" aria-label="Дни недели">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className="chip day"
              aria-pressed={Boolean(days & (1 << i))}
              onClick={() => toggleDay(i)}
            >
              {d}
            </button>
          ))}
        </div>
      </fieldset>

      <button className="block" onClick={save} disabled={!dirty || saving}>
        {saving ? "Сохраняю…" : saved && !dirty ? "Сохранено ✓" : "Сохранить"}
      </button>
      {error && <p className="error small">{error}</p>}
      {enabled && <p className="hint small tz">Часовой пояс: {timezone}</p>}
    </section>
  );
}
