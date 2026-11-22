"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import "../hub.css";

// Page ouverte par le lien du mail « Mot de passe oublié » :
// nouveau mot de passe + confirmation, puis retour à JAMAL (connecté).
//
// Deux types de liens sont acceptés :
//  - le lien Supabase classique (le jeton arrive dans l'adresse après #) ;
//  - un lien « token_hash » (?token_hash=...&type=recovery), que le mail peut utiliser :
//    le jeton n'est consommé qu'au moment d'enregistrer le mot de passe, donc
//    les analyseurs de liens des messageries ne peuvent plus le « brûler » avant toi.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } })
    : null;

type Status = "checking" | "ready" | "invalid" | "done";

export default function NewPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [tokenHash, setTokenHash] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");

  useEffect(() => {
    if (!supabase) { setStatus("invalid"); return; }
    const params = new URLSearchParams(window.location.search);
    const th = params.get("token_hash");
    if (th && params.get("type") === "recovery") {
      setTokenHash(th);
      setStatus("ready");
      return;
    }
    const hash = window.location.hash;
    const hasError = /error_code=|error_description=/.test(hash);
    const fromMail = /type=recovery/.test(hash);
    if (hasError || !fromMail) {
      setStatus("invalid");
      return;
    }
    let alive = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (alive && event === "PASSWORD_RECOVERY" && session) setStatus("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) setStatus((s) => (s === "checking" ? "ready" : s));
    });
    const t = setTimeout(() => { if (alive) setStatus((s) => (s === "checking" ? "invalid" : s)); }, 6000);
    return () => { alive = false; clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (p1.length < 6) { setError("Le mot de passe doit faire au moins 6 caractères."); return; }
    if (p1 !== p2) { setError("Les deux mots de passe ne sont pas identiques."); return; }
    if (!supabase) return;
    setBusy(true);
    if (tokenHash) {
      const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      if (vErr) { setBusy(false); setStatus("invalid"); return; }
    }
    const { error: err } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setStatus("done");
    setTimeout(() => window.location.replace("/"), 1500);
  }

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSent("");
    if (!supabase || !email.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + "/nouveau-mot-de-passe",
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent("Si un compte existe pour cette adresse, un nouveau mail vient d'être envoyé. Ouvre-le tout de suite, une seule fois.");
  }

  return (
    <div className="hub">
      <div className="wrap">
        <div className="top">
          <div className="brand"><span className="brand-dot">J</span> JAMAL</div>
        </div>

        <section className="login" style={{ margin: "40px auto" }}>
          {status === "checking" && (
            <>
              <h3>Un instant…</h3>
              <p className="sub">Vérification de ton lien.</p>
            </>
          )}

          {status === "ready" && (
            <>
              <h3>Nouveau mot de passe</h3>
              <p className="sub">Choisis ton nouveau mot de passe, puis confirme-le.</p>
              <form onSubmit={submit}>
                <input type="password" placeholder="Nouveau mot de passe (6 caractères minimum)" autoComplete="new-password" required minLength={6} value={p1} onChange={(e) => setP1(e.target.value)} autoFocus />
                <input type="password" placeholder="Confirmer le mot de passe" autoComplete="new-password" required minLength={6} value={p2} onChange={(e) => setP2(e.target.value)} />
                <p className="err" role="alert">{error}</p>
                <button className="go" type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le mot de passe"}</button>
              </form>
            </>
          )}

          {status === "invalid" && (
            <>
              <h3>Lien expiré ou déjà utilisé</h3>
              <p className="sub">Reçois un nouveau lien : écris ton adresse mail, puis ouvre le mail tout de suite.</p>
              <form onSubmit={resend}>
                <input type="email" placeholder="Adresse mail" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                <p className="err" role="alert">{error}</p>
                {sent && <p className="info">{sent}</p>}
                <button className="go" type="submit" disabled={busy}>{busy ? "Envoi…" : "Recevoir un nouveau lien"}</button>
              </form>
              <p className="more"><a href="/">Retour à JAMAL</a></p>
            </>
          )}

          {status === "done" && (
            <>
              <h3>Mot de passe mis à jour</h3>
              <p className="sub">Tu es connecté. Ouverture de ton espace…</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
