// Минимальные типы для window.Telegram.WebApp — только то, что используем.
interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string }; start_param?: string };
  colorScheme?: "light" | "dark";
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: "themeChanged", handler: () => void): void;
  ready(): void;
  expand(): void;
  openTelegramLink(url: string): void;
  showConfirm(message: string, callback: (ok: boolean) => void): void;
  requestWriteAccess?(callback: (allowed: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium"): void;
    notificationOccurred(type: "success" | "warning" | "error"): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;

export function haptic() {
  tg?.HapticFeedback?.impactOccurred("light");
}

export function notifyHaptic() {
  tg?.HapticFeedback?.notificationOccurred("success");
}

/** Разрешение боту писать человеку в личку; без него оповещения в Telegram не дойдут. */
export function requestWriteAccess(): Promise<boolean> {
  if (!tg?.requestWriteAccess) return Promise.resolve(true);
  return new Promise((resolve) => tg.requestWriteAccess!(resolve));
}

export function confirm(message: string): Promise<boolean> {
  if (!tg?.initData) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => tg.showConfirm(message, resolve));
}

export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.initData) tg.openTelegramLink(share);
  else window.open(share, "_blank");
}

/** Код приглашения: из ссылки бота (?join=) или из прямой ссылки на Mini App (startapp). */
export function joinCode(): string | undefined {
  return new URLSearchParams(location.search).get("join") ?? tg?.initDataUnsafe.start_param ?? undefined;
}

/** Светлая или тёмная палитра (design.md) — по теме Telegram, а вне Telegram — по системе. */
export function applyTheme() {
  const apply = () => {
    const dark = tg?.colorScheme
      ? tg.colorScheme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    // Шапку и фон самого Telegram красим в цвета приложения, чтобы не было полосы на стыке.
    const css = getComputedStyle(root);
    try {
      tg?.setHeaderColor?.(css.getPropertyValue("--c-header").trim());
      tg?.setBackgroundColor?.(css.getPropertyValue("--c-bg").trim());
    } catch {
      // Старые клиенты Telegram принимают только ключи темы — оставляем их цвета.
    }
  };
  apply();
  tg?.onEvent?.("themeChanged", apply);
}
