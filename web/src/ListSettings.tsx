import { useState, type FormEvent } from "react";
import { api, type Family, type Member } from "./api";
import { confirmDestructive, haptic } from "./telegram";

/**
 * Карточка «Настройки списка»: переименование (любой участник) и удаление (только создатель).
 * Участник, который не создавал список, может из него выйти.
 */
export function ListSettings({
  family,
  members,
  itemCount,
  onRenamed,
  onRemoved,
}: {
  family: Family;
  members: Member[];
  itemCount: number;
  onRenamed: (name: string) => void;
  /** Список удалён или пользователь из него вышел. */
  onRemoved: (how: "deleted" | "left") => void;
}) {
  const [name, setName] = useState(family.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== family.name;
  const owner = members.find((m) => m.isOwner);
  const memberCount = members.length || family.memberCount;
  const others = memberCount - 1;

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    run(async () => {
      const res = await api.renameFamily(family.id, trimmed);
      haptic();
      onRenamed(res.name);
    });
  }

  async function remove() {
    const who = others > 0 ? ` у вас и ещё ${others} ${plural(others, "участника", "участников", "участников")}` : "";
    const what = itemCount > 0 ? ` вместе со всеми товарами (${itemCount})` : "";
    const ok = await confirmDestructive(
      `Удалить «${family.name}»?`,
      `Список пропадёт${who}${what}. Отменить это нельзя.`,
      "Удалить",
    );
    if (!ok) return;
    run(async () => {
      await api.deleteFamily(family.id);
      onRemoved("deleted");
    });
  }

  async function leave() {
    const ok = await confirmDestructive(
      `Выйти из «${family.name}»?`,
      "Список пропадёт у вас, у остальных участников он останется. Вернуться можно по новому приглашению.",
      "Выйти",
    );
    if (!ok) return;
    run(async () => {
      await api.leaveFamily(family.id);
      onRemoved("left");
    });
  }

  return (
    <section className="card list-settings">
      <div className="card-head">
        <strong>Настройки списка</strong>
      </div>
      <form className="rename" onSubmit={rename}>
        <label className="field">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder=" " maxLength={60} disabled={busy} />
          <span>Название списка</span>
        </label>
        <button type="submit" disabled={!dirty || busy}>
          Сохранить
        </button>
      </form>
      <p className="hint small">Новое название увидят все участники.</p>

      <div className="danger-zone">
        {family.isOwner ? (
          <>
            <button className="block danger" onClick={remove} disabled={busy}>
              Удалить список
            </button>
            <p className="hint small">
              {others > 0
                ? "Список удалится у всех участников вместе с товарами. Это нельзя отменить."
                : "Список удалится вместе с товарами. Это нельзя отменить."}
            </p>
          </>
        ) : (
          <>
            <button className="block danger" onClick={leave} disabled={busy}>
              Выйти из списка
            </button>
            <p className="hint small">
              Удалить список для всех может только создатель{owner ? ` — ${owner.firstName}` : ""}.
            </p>
          </>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
