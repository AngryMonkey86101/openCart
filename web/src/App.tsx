import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Family, type Item, type ListEvent, type Member, type Notifications } from "./api";
import { confirm, haptic, joinCode, notifyHaptic, requestWriteAccess, shareLink, tg } from "./telegram";

const POLL_MS = 4000;
const LAST_FAMILY_KEY = "opencart:lastFamily";
const seenKey = (familyId: string) => `opencart:seen:${familyId}`;

function readNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Хранилище недоступно: оповещения просто покажутся ещё раз.
  }
}

export function App() {
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notifications>({ available: false, enabled: false });
  const [error, setError] = useState<string | null>(null);

  const loadFamilies = useCallback(async (prefer?: string) => {
    const { families, notifications } = await api.me();
    setFamilies(families);
    setNotifications(notifications);
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
      notifications={notifications}
      onNotificationsChange={setNotifications}
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
      <div className="logo" aria-hidden="true" />
      <h1>Список покупок</h1>
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
  notifications,
  onNotificationsChange,
}: {
  family: Family;
  families: Family[];
  onSwitch: (id: string) => void;
  onCreateNew: () => void;
  notifications: Notifications;
  onNotificationsChange: (n: Notifications) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [news, setNews] = useState<ListEvent[]>([]);
  // Последнее событие, уже полученное с сервера; null — ещё не загружали.
  const fetchedUpTo = useRef<number | null>(null);
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");

  const refresh = useCallback(async () => {
    const firstLoad = fetchedUpTo.current === null;
    const after = fetchedUpTo.current ?? readNumber(seenKey(family.id));
    const [{ items }, { members }, feed] = await Promise.all([
      api.items(family.id),
      api.members(family.id),
      api.events(family.id, after ?? 0),
    ]);
    setItems(items);
    setMembers(members);
    fetchedUpTo.current = Math.max(feed.lastId, after ?? 0);
    if (after === null) {
      // Первый запуск на этом устройстве: старые события не показываем.
      writeNumber(seenKey(family.id), feed.lastId);
    } else if (feed.events.length) {
      setNews((prev) => [...prev, ...feed.events.filter((e) => !prev.some((p) => p.id === e.id))]);
      if (!firstLoad) notifyHaptic();
    }
  }, [family.id]);

  function dismissNews() {
    writeNumber(seenKey(family.id), fetchedUpTo.current ?? 0);
    setNews([]);
  }

  useEffect(() => {
    setItems(null);
    setMembers([]);
    setNews([]);
    fetchedUpTo.current = null;
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

  async function toggleNotifications() {
    const enable = !notifications.enabled;
    if (enable && !(await requestWriteAccess())) return;
    const { enabled } = await api.setNotifications(enable);
    onNotificationsChange({ ...notifications, enabled });
  }

  function invite() {
    shareLink(family.inviteLink, `Присоединяйся к нашему списку покупок «${family.name}»`);
  }

  const todo = items?.filter((i) => !i.done) ?? [];
  const done = items?.filter((i) => i.done) ?? [];

  return (
    <div className="app">
      <header>
        <h1 className="list-title">{family.name}</h1>
        <div className="header-actions">
          <button className="secondary" onClick={() => setShowMembers((v) => !v)} aria-expanded={showMembers}>
            👥 Участники · {members.length || family.memberCount}
          </button>
          <button className="secondary" onClick={invite}>
            Пригласить
          </button>
          {notifications.available && (
            <button className="secondary" onClick={toggleNotifications} aria-pressed={notifications.enabled}>
              {notifications.enabled ? "🔔 Оповещения вкл." : "🔕 Оповещения в Telegram"}
            </button>
          )}
          {families.length > 1 && (
            <select
              className="secondary"
              value={family.id}
              onChange={(e) => (e.target.value === "__new" ? onCreateNew() : onSwitch(e.target.value))}
              aria-label="Другой список"
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value="__new">+ Новый список</option>
            </select>
          )}
        </div>
        {showMembers && (
          <div className="members">
            <p className="hint small">Все участники могут добавлять товары и отмечать купленное.</p>
            <ul>
              {members.map((m) => (
                <li key={m.id}>
                  <span className="avatar" aria-hidden="true">
                    {m.firstName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="name">
                    {m.firstName}
                    {m.username && <span className="meta"> @{m.username}</span>}
                  </span>
                  {m.isOwner && <span className="qty-badge">создатель</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {news.length > 0 && <News events={news} onDismiss={dismissNews} />}

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

const ACTIONS: Record<ListEvent["type"], string> = {
  added: "добавил(а)",
  done: "купил(а)",
  undone: "вернул(а) в список",
};

function ago(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function News({ events, onDismiss }: { events: ListEvent[]; onDismiss: () => void }) {
  const shown = events.slice(-5).reverse();
  return (
    <section className="news" aria-live="polite">
      <div className="news-head">
        <strong>Что нового</strong>
        <button className="link" onClick={onDismiss}>
          Понятно
        </button>
      </div>
      <ul>
        {shown.map((e) => (
          <li key={e.id}>
            <span className={`dot ${e.type}`} aria-hidden="true" />
            <span className="text">
              {e.actor} {ACTIONS[e.type]} «{e.itemTitle}»<span className="meta"> · {ago(e.createdAt)}</span>
            </span>
          </li>
        ))}
      </ul>
      {events.length > shown.length && <p className="hint small">и ещё {events.length - shown.length}</p>}
    </section>
  );
}
