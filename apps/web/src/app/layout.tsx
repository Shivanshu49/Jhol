import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import { MotionProvider } from "./motion-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jhol: find the jhol in your checkout",
  description: "An AI agent that shops your site like a real customer and reports dark patterns against CCPA's 13, with proof.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-x-hidden font-sans antialiased">
        <MotionProvider>
          <header className="sticky top-0 z-50 border-b border-white/15 bg-accent backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <div className="flex items-baseline gap-4">
                <Link href="/" className="text-xl font-black tracking-tight text-white">
                  jhol<span className="text-primary">.</span>
                </Link>
                <span className="hidden text-xs text-white/70 sm:inline">Dark-pattern audits for Indian checkouts</span>
              </div>
              <Link
                href="/#audit"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary-hover"
              >
                Run an audit
                <span aria-hidden>↘</span>
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
        </MotionProvider>
      </body>
    </html>
  );
}
