import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Dashboard } from "../pages/Dashboard";
import { Portfolio } from "../pages/Portfolio";
import { Watchlist } from "../pages/Watchlist";
import { Settings } from "../pages/Settings";

type Page = "dashboard" | "portfolio" | "watchlist" | "settings";

const NAV: { key: Page; label: string; ico: string }[] = [
  { key: "dashboard", label: "Dashboard", ico: "🏠" },
  { key: "portfolio", label: "Portfolio", ico: "💰" },
  { key: "watchlist", label: "Watchlist", ico: "⭐" },
  { key: "settings", label: "Settings", ico: "⚙️" },
];

export function AppShell({ session }: { session: Session }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [open, setOpen] = useState(false);

  function go(p: Page) {
    setPage(p);
    setOpen(false);
  }

  const title = NAV.find((n) => n.key === page)?.label ?? "Navis";

  return (
    <div className="shell">
      <header className="topbar">
        <button className="hamburger" aria-label="Menu" onClick={() => setOpen(true)}>
          <span />
        </button>
        <h1>Navis AI · {title}</h1>
        <div className="spacer" />
      </header>

      <div className={`scrim ${open ? "open" : ""}`} onClick={() => setOpen(false)} />
      <nav className={`drawer ${open ? "open" : ""}`}>
        <div className="brand">Navis AI</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`navitem ${page === n.key ? "active" : ""}`}
            onClick={() => go(n.key)}
          >
            <span className="ico">{n.ico}</span>
            {n.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {page === "dashboard" && <Dashboard />}
        {page === "portfolio" && <Portfolio />}
        {page === "watchlist" && <Watchlist />}
        {page === "settings" && <Settings session={session} />}
      </main>
    </div>
  );
}
