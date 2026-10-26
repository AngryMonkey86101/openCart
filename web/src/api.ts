import { tg } from "./telegram";

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  memberCount: number;
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
  me: () => request<{ families: Family[] }>("GET", "/me"),
  createFamily: (name: string) => request<{ id: string }>("POST", "/families", { name }),
  joinFamily: (code: string) => request<{ id: string }>("POST", "/families/join", { code }),
  items: (familyId: string) => request<{ items: Item[] }>("GET", `/families/${familyId}/items`),
  addItem: (familyId: string, title: string, qty?: string) =>
    request<{ id: number }>("POST", `/families/${familyId}/items`, { title, qty }),
  setDone: (id: number, done: boolean) => request("PATCH", `/items/${id}`, { done }),
  deleteItem: (id: number) => request("DELETE", `/items/${id}`),
  clearDone: (familyId: string) => request("POST", `/families/${familyId}/clear-done`),
};
