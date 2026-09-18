import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["300", "400", "500"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Closing Bell",
  description:
    "The true cost of a tokenized stock trade: pool impact plus the wrapper premium nothing else shows.",
  manifest: "/manifest.json",
};

const NAV = [
  { href: "/", label: "Start" },
  { href: "/trade", label: "Trade" },
  { href: "/proof", label: "Proof" },
  { href: "/findings", label: "Findings" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-50 border-b border-rule bg-ground/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3.5">
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/nav-logo.png"
                alt=""
                width={20}
                height={20}
                className="rounded-[4px]"
                priority
              />
              <span className="font-display text-[17px] leading-none tracking-tight text-ink">
                Closing Bell
              </span>
            </Link>
            <nav className="flex items-center gap-5 text-[13px]">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-ink-dim transition-colors hover:text-ink"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
