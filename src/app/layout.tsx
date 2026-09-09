import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "LeadForge · Gemfield",
  description: "Internal lead generation — free-first data, scored by website opportunity.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="flex min-h-screen flex-col md:flex-row">
          {/* sidebar on md+, wrapping top bar on phones */}
          <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-line bg-panel/60 p-3 md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r md:p-4">
            <div className="flex items-center gap-2.5 px-2 py-1 md:mb-4">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-[0_8px_20px_-8px_rgb(16_185_129/0.6)]"
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />
                </svg>
              </div>
              <div className="leading-tight">
                <div className="text-[15px] font-bold tracking-tight text-white">LeadForge</div>
                <div className="text-[11px] text-zinc-500">Gemfield internal</div>
              </div>
            </div>
            <Nav />
            <div className="mt-auto hidden px-2 pt-6 text-[10px] leading-4 text-zinc-600 md:block">
              Data © Overture Maps Foundation (CDLA-P-2.0) · © Foursquare OS Places (Apache-2.0) · Cities © SimpleMaps
              (CC-BY-4.0)
            </div>
          </aside>
          <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
            {/* license requirement (AGENTS.md): attribution stays visible on phones too */}
            <footer className="mx-auto mt-8 w-full max-w-6xl px-1 pb-2 text-[10px] leading-4 text-zinc-600 md:hidden">
              Data © Overture Maps Foundation (CDLA-P-2.0) · © Foursquare OS Places (Apache-2.0) · Cities © SimpleMaps (CC-BY-4.0)
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
}
