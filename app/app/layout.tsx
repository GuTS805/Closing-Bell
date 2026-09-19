import type { Metadata } from "next";
import { Manrope, Inter, IBM_Plex_Mono } from "next/font/google";
import Navbar from "./components/Navbar";
import PageMotion from "./components/PageMotion";
import WalletContextProvider from "./components/WalletContextProvider";
import Link from "next/link";
import "./globals.css";

const displayFont = Manrope({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
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


export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head><script dangerouslySetInnerHTML={{ __html: '(function(){try{document.documentElement.dataset.theme=localStorage.getItem("closing-bell-theme")==="dark"?"dark":"light"}catch(e){}})()' }} /></head>
      <body className="min-h-full flex flex-col">
        <WalletContextProvider>
          <a href="#main-content" className="skip-link">Skip to content</a><Navbar />
          <div id="main-content" className="flex-1" tabIndex={-1}><PageMotion>{children}</PageMotion></div><footer className="site-footer"><Link href="/" className="font-display text-xl">Closing Bell.</Link><p>Know the price. See the whole picture.</p><span>Built on Solana <span aria-hidden="true">↗</span></span></footer>
        </WalletContextProvider>
      </body>
    </html>
  );
}
