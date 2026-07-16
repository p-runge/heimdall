import type { Metadata } from "next";
import { Cinzel, Inter, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { AlertsNavLink } from "@/components/alerts-nav-link";
import "./globals.css";

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Heimdall — All-Seeing Site Watch",
  description:
    "Health, deploy-drift, and SEO rank monitoring for every website you maintain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${cinzel.variable} ${inter.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-void font-sans antialiased">
        <header className="border-b border-mist-800/60 bg-void-raised/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Logo />
            <nav className="flex items-center gap-6 text-sm text-mist-300">
              <Link href="/" className="hover:text-mist-100 transition-colors">
                Watchtower
              </Link>
              <Link href="/clients" className="hover:text-mist-100 transition-colors">
                Clients
              </Link>
              <AlertsNavLink />
              <Link href="/settings" className="hover:text-mist-100 transition-colors">
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
