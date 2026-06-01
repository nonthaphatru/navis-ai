import { useState } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      const m = (error.message || "").toLowerCase();
      if (m.includes("invalid login")) setErr("Wrong email or password.");
      else setErr(error.message || "Could not sign in.");
    }
    // On success, the auth listener in App.tsx swaps to the dashboard.
  }

  return (
    <div className="center-screen">
      <div className="glass login-card">
        <div className="brand" style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>
          Navis AI
        </div>
        <p className="sub" style={{ marginBottom: 20 }}>Your private market dashboard</p>
        <form onSubmit={signIn}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {err && <p className="error" style={{ marginBottom: 10 }}>{err}</p>}
          <button className="btn btn-accent" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
