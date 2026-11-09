declare const __BUILD_ID__: string;

const CHECK_MS = 60_000;
const RELOADED_KEY = "opencart:reloadedFor";

async function serverBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { build?: string }).build ?? null;
  } catch {
    return null;
  }
}

/** Пользователь что-то печатает — не перезагружаем, чтобы не потерять ввод. */
function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement && el.value.trim() !== "";
}

/**
 * Следит за версией на сервере: при возвращении в приложение и раз в минуту.
 * Если вышла новая сборка, перезагружает страницу, чтобы Telegram не показывал старую из кэша.
 */
export function watchForUpdates() {
  if (import.meta.env.DEV) return;
  let reloading = false;
  const check = async () => {
    if (reloading || isTyping()) return;
    const build = await serverBuild();
    if (!build || build === __BUILD_ID__) return;
    // Один раз на каждую новую сборку: если после перезагрузки всё равно открылась старая
    // (например, Telegram отдал её из кэша), не уходим в бесконечный цикл.
    try {
      if (sessionStorage.getItem(RELOADED_KEY) === build) return;
      sessionStorage.setItem(RELOADED_KEY, build);
    } catch {
      return;
    }
    reloading = true;
    // Параметр v меняет адрес, чтобы обойти кэш index.html.
    const url = new URL(location.href);
    url.searchParams.set("v", build);
    location.replace(url.toString());
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") check();
  }, CHECK_MS);
  check();
}
