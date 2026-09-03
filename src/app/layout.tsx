import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadForge · Gemfield",
  description: "Internal lead generation — free-first data, scored by website opportunity.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/leads", label: "Leads" },
  { href: "/exports", label: "Exports" },
  { href: "/suppressions", label: "Suppressions" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-6 px-2">
              <div className="text-lg font-bold tracking-tight text-emerald-400">LeadForge</div>
              <div className="text-[11px] text-zinc-500">Gemfield internal</div>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto px-2 pt-6 text-[10px] leading-4 text-zinc-600">
              Data © Overture Maps Foundation (CDLA-P-2.0) · © Foursquare OS Places (Apache-2.0) · Cities © SimpleMaps
              (CC-BY-4.0)
            </div>
          </aside>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
