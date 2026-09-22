"use client";

import { useRef, useState, type ReactNode } from "react";

export interface ReadoutPoint { x: number; y: number; text: string }

/** Only actual plotted points are selectable; empty space has no synthetic values. */
export default function ChartReadout({ children, points, width, height, label, duplicated = false, crosshair = false }: {
  children: ReactNode; points: ReadoutPoint[]; width: number; height: number;
  label: string; duplicated?: boolean; crosshair?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const point = active === null ? undefined : points[active];
  return <div className="chart-interaction">
    <div className="chart-interaction-scroll">
      <div ref={surface} className="chart-interaction-surface" tabIndex={0} role="group"
        aria-label={`${label}. Use arrow keys to inspect recorded points, Home or End to jump, Escape to dismiss.${point ? ` ${point.text}` : ""}`}
        onFocus={() => setActive(points.length ? 0 : null)}
        onBlur={() => setActive(null)}
        onKeyDown={event => {
          if (event.key === "Escape") { setActive(null); return; }
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          if (!points.length) return;
          const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
            : Math.max(0, Math.min(points.length - 1, (active ?? 0) + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
          setActive(next);
          const node = surface.current;
          if (node) node.parentElement?.scrollTo({ left: points[next].x / width * node.clientWidth - node.parentElement.clientWidth / 2 });
        }}
        onPointerMove={event => {
          if (event.pointerType === "touch") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          let nearest: number | null = null, distance = 12;
          points.forEach((p, i) => {
            const delta = Math.hypot(p.x / width * bounds.width - (event.clientX - bounds.left), p.y / height * bounds.height - (event.clientY - bounds.top));
            if (delta < distance) { nearest = i; distance = delta; }
          });
          setActive(nearest);
        }}
        onPointerLeave={event => { if (event.pointerType !== "touch") setActive(null); }}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          let nearest: number | null = null, distance = 24;
          points.forEach((p, i) => {
            const delta = Math.hypot(p.x / width * bounds.width - (event.clientX - bounds.left), p.y / height * bounds.height - (event.clientY - bounds.top));
            if (delta < distance) { nearest = i; distance = delta; }
          });
          setActive(nearest);
        }}>
        {children}
        {point && <div className="chart-pointer" aria-hidden="true" style={{ left: `${point.x / width * 100}%`, top: `${point.y / height * 100}%` }}><span /></div>}
        {point && crosshair && <div className="chart-crosshair" aria-hidden="true" style={{ left: `${point.x / width * 100}%` }} />}
      </div>
    </div>
    <div className="chart-readout" aria-hidden={duplicated || undefined} aria-live={duplicated ? undefined : "polite"} aria-atomic="true">
      {point ? point.text : "Hover or tap a point. Focus the chart and use arrow keys to inspect."}
    </div>
  </div>;
}
