"use client";

import dynamic from "next/dynamic";

/** The wallet-adapter stack touches window/localStorage at import time, so it never runs server-side. */
const PositionApp = dynamic(() => import("./PositionApp"), {
  ssr: false,
  loading: () => (
    <main className="workspace-page position-page mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <div className="eyebrow page-eyebrow">
        <span className="status-dot" />YOUR POSITION
      </div>
      <p className="mt-10 text-[14px] text-ink-faint">Loading…</p>
    </main>
  ),
});

export default function PositionPage() {
  return <PositionApp />;
}
