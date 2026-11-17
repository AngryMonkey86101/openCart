import { tg } from "./telegram";

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  memberCount: number;
  /** Текущий пользователь создал этот список: только он может его удалить. */
  isOwner: boolean;
}

export interface Notifications {
  /** На сервере настроен посредник для сообщений в Telegram. */
  available: boolean;
  enabled: boolean;
}

/** Ежедневное напоминание об активных списках. */
export interface Reminder {
  enabled: boolean;
  /** Местное время «ЧЧ:ММ». */
  time: string;
  /** Дни недели битами: Пн = 1, Вт = 2, … Вс = 64. */
  days: number;
  timezone: string;
}

export interface Member {
  id: number;
  firstName: string;
  username: string | null;
  isOwner: boolean;
}

export interface ListEvent {
  id: number;
  type: "added" | "done" | "undone" | "renamed";
  itemTitle: string;
  actor: string;
  createdAt: number;
}

export interface Item {
  id: number;
  title: string;
  qty: string | null;
  done: boolean;
  addedBy: string;
  doneBy: string | null;
  createdAt: number;
}

/** Ошибка API с HTTP-статусом: по 404 приложение понимает, что список удалён. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `tma ${tg?.initData ?? ""}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => request<{ families: Family[]; notifications: Notifications; reminder: Reminder }>("GET", "/me"),
  setReminder: (r: Reminder) => request<Reminder>("POST", "/me/reminder", r),
  setNotifications: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/me/notifications", { enabled }),
  createFamily: (name: string) => request<{ id: string }>("POST", "/families", { name }),
  renameFamily: (familyId: string, name: string) =>
    request<{ id: string; name: string }>("PATCH", `/families/${familyId}`, { name }),
  deleteFamily: (familyId: string) => request("DELETE", `/families/${familyId}`),
  leaveFamily: (familyId: string) => request("POST", `/families/${familyId}/leave`),
  joinFamily: (code: string) => request<{ id: string }>("POST", "/families/join", { code }),
  members: (familyId: string) => request<{ members: Member[] }>("GET", `/families/${familyId}/members`),
  events: (familyId: string, after: number) =>
    request<{ events: ListEvent[]; lastId: number }>("GET", `/families/${familyId}/events?after=${after}`),
  items: (familyId: string) => request<{ name: string; items: Item[] }>("GET", `/families/${familyId}/items`),
  addItem: (familyId: string, title: string, qty?: string) =>
    request<{ id: number }>("POST", `/families/${familyId}/items`, { title, qty }),
  setDone: (id: number, done: boolean) => request("PATCH", `/items/${id}`, { done }),
  deleteItem: (id: number) => request("DELETE", `/items/${id}`),
  clearDone: (familyId: string) => request("POST", `/families/${familyId}/clear-done`),
};
