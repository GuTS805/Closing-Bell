"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const eventName = "closing-bell-theme";
function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === "closing-bell-theme") {
      document.documentElement.dataset.theme = event.newValue === "dark" ? "dark" : "light";
      onChange();
    }
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
const serverTheme = (): Theme => "light";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, serverTheme);
  function toggleTheme() {
    const next = getTheme() === "light" ? "dark" : "light";
    const update = () => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("closing-bell-theme", next); } catch { /* Storage is optional. */ }
      window.dispatchEvent(new Event(eventName));
    };
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const transition = document.startViewTransition(update);
      void transition.finished.catch(() => { /* Rapid toggles can skip the visual transition. */ });
    } else {
      update();
    }
  }
  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
