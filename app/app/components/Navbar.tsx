"use client";

import Image from "next/image";
import ThemeToggle from "./ThemeToggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/", label: "Overview" },
  { href: "/trade", label: "Trade Calculator" },
  { href: "/proof", label: "On-chain Proof" },
  { href: "/findings", label: "Research" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link href="/" className="brand" onClick={() => setOpen(false)} aria-label="Closing Bell home">
          <Image src="/brands/closing-bell.svg" alt="" width={64} height={64} priority />
          <span>Closing <b>Bell</b><span className="brand-caption">TOKENIZED STOCKS. FULL TRANSPARENCY.</span></span>
        </Link>
        <div className="nav-utilities"><ThemeToggle />
        <button ref={toggle} className="menu-toggle" aria-expanded={open} aria-controls="primary-navigation" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>
          <span className={open ? "menu-lines is-open" : "menu-lines"}><i /><i /></span>
        </button></div>
        <nav id="primary-navigation" aria-label="Main navigation" className={`primary-nav ${open ? "nav-open" : ""}`}>
          {links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} onClick={() => setOpen(false)}>{link.label}</Link>)}
          <Link href="/#faq" onClick={() => setOpen(false)}>FAQ</Link>
          <Link href="/trade" className="nav-action" onClick={() => setOpen(false)}>Check a token <span aria-hidden="true">&rarr;</span></Link>
        </nav>
      </div>
    </header>
  );
}
