import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jhol: find the hidden charges in any checkout",
  description:
    "Jhol shops a store like a real customer, marks every hidden fee and pre-ticked add-on with proof, and has Codex fix the checkout.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Link href="/" className="display text-3xl">
            jhol
          </Link>
          <Link href="/#try" className="font-semibold text-bluepen underline decoration-2 underline-offset-4">
            Audit a store
          </Link>
        </header>
        <main className="mx-auto max-w-6xl px-5 pb-16">{children}</main>
      </body>
    </html>
  );
}
