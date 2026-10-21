import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jhol: find the jhol in your checkout",
  description: "An AI agent that shops your site like a real customer and reports dark patterns against CCPA's 13, with proof.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-ink/10">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-xl font-black tracking-tight">
              jhol<span className="text-brand">.</span>
            </Link>
            <span className="text-xs text-ink/60">Dark-pattern audits for Indian checkouts</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
