"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Animate the existing route container without remounting its stateful children. */
export default function PageMotion({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = container.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!node || preference.matches) return;

    const animations: Animation[] = [];
    const enter = node.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 320, easing: "cubic-bezier(.22, 1, .36, 1)" },
    );
    animations.push(enter);

    // Only reveal cards below the fold; above-the-fold content is ready immediately.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("motion-await");
        if (!preference.matches) {
          animations.push(entry.target.animate(
            [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }],
            { duration: 420, easing: "cubic-bezier(.22, 1, .36, 1)" },
          ));
        }
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    const cards = node.querySelectorAll(".feature-card, .workspace-page > section, .explainer");
    cards.forEach((card) => {
      if (card.getBoundingClientRect().top > window.innerHeight) {
        card.classList.add("motion-await");
        observer.observe(card);
      }
    });
    const stop = () => {
      if (preference.matches) {
        animations.forEach((animation) => animation.cancel());
        observer.disconnect();
        cards.forEach((card) => card.classList.remove("motion-await"));
      }
    };
    preference.addEventListener("change", stop);
    return () => {
      animations.forEach((animation) => animation.cancel());
      observer.disconnect();
      cards.forEach((card) => card.classList.remove("motion-await"));
      preference.removeEventListener("change", stop);
    };
  }, [pathname]);

  return <div ref={container} className="page-motion">{children}</div>;
}
