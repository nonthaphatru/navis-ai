import { useState } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    // Redirect back to this app's base URL (must be allow-listed in Supabase Auth).
    const redirectTo = window.location.origin + import.meta.env.BASE_URL;
    // shouldCreateUser:false -> only pre-approved accounts can sign in. Combined
    // with sign-ups being disabled server-side, unknown emails are rejected.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) setErr("That email isn't authorized for this app.");
    else setSent(true);
  }

  return (
    <div className="center-screen">
      <div className="glass login-card">
        <div className="brand" style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>
          Navis AI
        </div>
        <p className="sub" style={{ marginBottom: 20 }}>
          Your private market dashboard
        </p>
        {sent ? (
          <p className="ok">
            ✅ Check your email — tap the magic link to sign in. You can close this tab.
          </p>
        ) : (
          <form onSubmit={sendLink}>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {err && <p className="error" style={{ marginBottom: 10 }}>{err}</p>}
            <button className="btn btn-accent" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
