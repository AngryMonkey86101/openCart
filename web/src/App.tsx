import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Family, type Item } from "./api";
import { confirm, haptic, joinCode, shareLink, tg } from "./telegram";

const POLL_MS = 4000;
const LAST_FAMILY_KEY = "opencart:lastFamily";

export function App() {
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFamilies = useCallback(async (prefer?: string) => {
    const { families } = await api.me();
    setFamilies(families);
    const saved = prefer ?? localStorage.getItem(LAST_FAMILY_KEY);
    setFamilyId(families.find((f) => f.id === saved)?.id ?? families[0]?.id ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const code = joinCode();
        const joined = code ? (await api.joinFamily(code).catch(() => null))?.id : undefined;
        await loadFamilies(joined);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadFamilies]);

  useEffect(() => {
    if (familyId) localStorage.setItem(LAST_FAMILY_KEY, familyId);
  }, [familyId]);

  if (!tg?.initData) {
    return <div className="center">Откройте это приложение через бота в Telegram.</div>;
  }
  if (error) return <div className="center error">Не удалось загрузить: {error}</div>;
  if (!families) return <div className="center hint">Загрузка…</div>;

  const family = families.find((f) => f.id === familyId);
  if (!family) {
    return (
      <CreateFamily
        onCreated={(id) => loadFamilies(id)}
        onCancel={families.length ? () => setFamilyId(families[0].id) : undefined}
      />
    );
  }

  return (
    <ShoppingList
      family={family}
      families={families}
      onSwitch={setFamilyId}
      onCreateNew={() => setFamilyId(null)}
    />
  );
}

function CreateFamily({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("Наш список");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api.createFamily(name);
      onCreated(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="onboarding" onSubmit={submit}>
      <h1>🛒 Список покупок</h1>
      <p className="hint">
        Создайте общий список и отправьте приглашение близким — все будут видеть одни и те же покупки.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название списка" maxLength={60} />
      <button type="submit" disabled={busy}>
        Создать список
      </button>
      {onCancel ? (
        <button type="button" className="link" onClick={onCancel}>
          Назад к спискам
        </button>
      ) : (
        <p className="hint small">Если вас пригласили, откройте ссылку-приглашение из чата.</p>
      )}
    </form>
  );
}

function ShoppingList({
  family,
  families,
  onSwitch,
  onCreateNew,
}: {
  family: Family;
  families: Family[];
  onSwitch: (id: string) => void;
  onCreateNew: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");

  const refresh = useCallback(async () => {
    const { items } = await api.items(family.id);
    setItems(items);
  }, [family.id]);

  useEffect(() => {
    setItems(null);
    refresh();
    // Простой «реалтайм»: опрашиваем сервер, пока приложение на экране.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    setQty("");
    haptic();
    await api.addItem(family.id, t, qty.trim() || undefined);
    await refresh();
  }

  async function toggle(item: Item) {
    haptic();
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) ?? prev);
    await api.setDone(item.id, !item.done);
    await refresh();
  }

  async function remove(item: Item) {
    setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? prev);
    await api.deleteItem(item.id);
    await refresh();
  }

  async function clearDone() {
    if (!(await confirm("Удалить все купленные товары из списка?"))) return;
    await api.clearDone(family.id);
    await refresh();
  }

  function invite() {
    shareLink(family.inviteLink, `Присоединяйся к нашему списку покупок «${family.name}»`);
  }

  const todo = items?.filter((i) => !i.done) ?? [];
  const done = items?.filter((i) => i.done) ?? [];

  return (
    <div className="app">
      <header>
        {families.length > 1 ? (
          <select
            value={family.id}
            onChange={(e) => (e.target.value === "__new" ? onCreateNew() : onSwitch(e.target.value))}
          >
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="__new">+ Новый список</option>
          </select>
        ) : (
          <h1>{family.name}</h1>
        )}
        <button className="secondary" onClick={invite}>
          👪 Пригласить{family.memberCount > 1 ? ` (${family.memberCount})` : ""}
        </button>
      </header>

      <form className="add" onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что купить?" maxLength={120} />
        <input className="qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Кол-во" maxLength={30} />
        <button type="submit" disabled={!title.trim()} aria-label="Добавить">
          +
        </button>
      </form>

      {items === null ? (
        <p className="hint center">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="hint center">Список пуст. Добавьте первый товар.</p>
      ) : (
        <>
          <ul className="items">
            {todo.map((i) => (
              <ItemRow key={i.id} item={i} onToggle={toggle} onRemove={remove} />
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <div className="section">
                <span>Куплено · {done.length}</span>
                <button className="link" onClick={clearDone}>
                  Очистить
                </button>
              </div>
              <ul className="items done">
                {done.map((i) => (
                  <ItemRow key={i.id} item={i} onToggle={toggle} onRemove={remove} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {families.length === 1 && (
        <button className="link new-list" onClick={onCreateNew}>
          + Создать ещё один список
        </button>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onRemove,
}: {
  item: Item;
  onToggle: (i: Item) => void;
  onRemove: (i: Item) => void;
}) {
  return (
    <li>
      <label>
        <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
        <span className="title">
          {item.title}
          {item.qty && <span className="qty-badge">{item.qty}</span>}
          <span className="meta">{item.done && item.doneBy ? `купил(а) ${item.doneBy}` : item.addedBy}</span>
        </span>
      </label>
      <button className="icon" onClick={() => onRemove(item)} aria-label="Удалить">
        ✕
      </button>
    </li>
  );
}
