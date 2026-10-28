import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tg } from "./telegram";
import { watchForUpdates } from "./version";
import "./styles.css";

tg?.ready();
tg?.expand();
watchForUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
