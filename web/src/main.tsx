import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, tg } from "./telegram";
import { watchForUpdates } from "./version";
import "@fontsource-variable/nunito/wght.css";
import "./styles.css";

tg?.ready();
tg?.expand();
applyTheme();
// С системной кнопкой «Назад» свой крестик на экране приглашения не нужен.
if (tg?.BackButton) document.documentElement.classList.add("in-telegram");
watchForUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
