import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { AppSettings } from "../types";

const DEFAULTS: AppSettings = {
  holding_move_pct: 4,
  watch_move_pct: 7,
  sec_alerts_enabled: true,
  earnings_alerts_enabled: true,
};

export function Settings({ session }: { session: Session }) {
  const [s, setS] = useState<AppSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("holding_move_pct, watch_move_pct, sec_alerts_enabled, earnings_alerts_enabled")
        .limit(1)
        .maybeSingle();
      if (data) setS(data as AppSettings);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setErr(""); setSaved(false);
    const { error } = await supabase.from("app_settings").upsert(
      { user_id: session.user.id, ...s, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) setErr(error.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

  if (loading) return <div className="spin">Loading…</div>;

  return (
    <div>
      <h2 className="page-title">Settings</h2>

      <div className="glass card">
        <div className="section-label">Alert thresholds</div>
        <div className="field">
          <label>Holding move alert (%) — tighter, for stocks you own</label>
          <input type="number" step="any" value={s.holding_move_pct}
            onChange={(e) => setS({ ...s, holding_move_pct: parseFloat(e.target.value) })} />
        </div>
        <div className="field">
          <label>Watchlist move alert (%)</label>
          <input type="number" step="any" value={s.watch_move_pct}
            onChange={(e) => setS({ ...s, watch_move_pct: parseFloat(e.target.value) })} />
        </div>
      </div>

      <div className="glass card" style={{ marginTop: 14 }}>
        <div className="section-label">Alert types</div>
        <div className="list-row">
          <span>SEC filing alerts</span>
          <button className={`switch ${s.sec_alerts_enabled ? "on" : ""}`}
            onClick={() => setS({ ...s, sec_alerts_enabled: !s.sec_alerts_enabled })} />
        </div>
        <div className="list-row">
          <span>Earnings reminders</span>
          <button className={`switch ${s.earnings_alerts_enabled ? "on" : ""}`}
            onClick={() => setS({ ...s, earnings_alerts_enabled: !s.earnings_alerts_enabled })} />
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn btn-accent" onClick={save}>Save settings</button>
        {saved && <span className="ok" style={{ alignSelf: "center" }}>Saved ✓</span>}
      </div>
      {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}

      <div className="glass card" style={{ marginTop: 24 }}>
        <div className="section-label">Account</div>
        <div className="list-row">
          <span className="dim">{session.user.email}</span>
          <button className="btn btn-sm btn-danger" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
