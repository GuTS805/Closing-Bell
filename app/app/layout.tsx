import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Closing Bell",
  description:
    "The true cost of a tokenized stock trade: pool impact plus the wrapper premium nothing else shows.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <header className="sticky top-0 z-50 border-b border-neutral-900 bg-neutral-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Closing Bell
            </Link>
            <nav className="flex gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-2.5 py-1 text-xs text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100"
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
