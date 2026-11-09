import { tg } from "./telegram";

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  memberCount: number;
}

export interface Notifications {
  /** На сервере настроен посредник для сообщений в Telegram. */
  available: boolean;
  enabled: boolean;
}

export interface Member {
  id: number;
  firstName: string;
  username: string | null;
  isOwner: boolean;
}

export interface ListEvent {
  id: number;
  type: "added" | "done" | "undone";
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
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => request<{ families: Family[]; notifications: Notifications }>("GET", "/me"),
  setNotifications: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/me/notifications", { enabled }),
  createFamily: (name: string) => request<{ id: string }>("POST", "/families", { name }),
  joinFamily: (code: string) => request<{ id: string }>("POST", "/families/join", { code }),
  members: (familyId: string) => request<{ members: Member[] }>("GET", `/families/${familyId}/members`),
  events: (familyId: string, after: number) =>
    request<{ events: ListEvent[]; lastId: number }>("GET", `/families/${familyId}/events?after=${after}`),
  items: (familyId: string) => request<{ items: Item[] }>("GET", `/families/${familyId}/items`),
  addItem: (familyId: string, title: string, qty?: string) =>
    request<{ id: number }>("POST", `/families/${familyId}/items`, { title, qty }),
  setDone: (id: number, done: boolean) => request("PATCH", `/items/${id}`, { done }),
  deleteItem: (id: number) => request("DELETE", `/items/${id}`),
  clearDone: (familyId: string) => request("POST", `/families/${familyId}/clear-done`),
};
