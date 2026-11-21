"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";
import "./hub.css";

// Même compte et même session que JamsPlans (même URL Supabase = même stockage de session).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } }) : null;

// Page d'accueil « Mon espace » : un bouton par module.
//  - JamsPlans    -> /jamsplans   (app/jamsplans/page.tsx)
//  - JAMAL PERMIS -> /permis      (public/permis.html, via rewrite dans next.config.js)
//  - Langue       -> /langue      (public/langue.html, via rewrite dans next.config.js)
// Un seul compte (Supabase, celui de JamsPlans) ouvre tous les modules : connecté = tout est débloqué.
export default function Home() {
  const [today, setToday] = useState("");
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // undefined = on vérifie encore la session, null = pas connecté
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Les liens de Supabase (mot de passe oublié, confirmation d'email) renvoient
    // à la racine du site : on les transmet à JamsPlans, qui sait les traiter.
    const { hash, search } = window.location;
    if (/access_token|type=recovery|error_description|error_code/.test(hash) || /[?&]code=/.test(search)) {
      window.location.replace("/jamsplans" + search + hash);
      return;
    }
    setToday(
      new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    );

    const wanted = new URLSearchParams(search).get("connexion");
    if (wanted === "permis") notify("Connecte-toi pour ouvrir JAMAL PERMIS.");
    if (wanted === "langue") notify("Connecte-toi pour ouvrir Langue.");

    if (!supabase) { setUser(null); return; } // Supabase non configuré : pas de compte possible
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const locked = user === null; // connecté = false ; en cours de vérification = on laisse passer

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    if (!supabase) { setBusy(false); setError("Connexion indisponible pour le moment."); return; }
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message);
    else setPassword("");
  }

  function guard(e: React.MouseEvent) {
    if (!locked) return;
    e.preventDefault();
    notify("Connecte-toi pour ouvrir tes modules.");
    document.getElementById("hub-login")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function notify(text: string) {
    setToast(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 2200);
  }

  function soon(e: React.MouseEvent, name: string) {
    e.preventDefault();
    if (locked) return guard(e);
    notify(name + " sera branché très bientôt.");
  }

  return (
    <div className="hub">
      <div className="wrap">
        <div className="top">
          <div className="brand"><span className="brand-dot">M</span> Mon espace</div>
          <div className="session">
            <span suppressHydrationWarning style={{ textTransform: "capitalize" }}>{today}</span>
            {user && (
              <>
                <b title={user.email ?? ""}>{user.email}</b>
                <button className="linkbtn" onClick={() => supabase?.auth.signOut()}>Déconnexion</button>
              </>
            )}
          </div>
        </div>

        <section className="hero">
          <span className="pill">⚡ Upgrade</span>
          <h1>Bienvenue dans <em>ton espace</em> pour progresser.</h1>
          <p>Discipline, permis, langues : tout ce que tu construis pour devenir meilleur chaque jour, au même endroit. Choisis un module et avance.</p>
        </section>

        {locked && (
          <section className="login" id="hub-login">
            <h3>Connecte-toi</h3>
            <p className="sub">Un seul compte ouvre tous tes modules : JamsPlans, JAMAL PERMIS, Langue.</p>
            <form onSubmit={signIn}>
              <input type="email" placeholder="Adresse mail" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" placeholder="Mot de passe" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="err" role="alert">{error}</p>
              <button className="go" type="submit" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
            </form>
            <p className="more">Pas encore de compte, ou mot de passe oublié ? <a href="/jamsplans">C'est par ici</a>.</p>
          </section>
        )}

        <section className="grid" aria-label="Mes modules">
          <a className={"card c-plans" + (locked ? " locked" : "")} href="/jamsplans" aria-label="Ouvrir JamsPlans" onClick={guard}>
            <span className="badge">En ligne</span>
            <div className="icon">🎯</div>
            <h2>JamsPlans</h2>
            <p>Ta discipline au quotidien : objectifs, planning, journée type, check-liste du soir et récap pour ne rien lâcher.</p>
            <div className="tags"><span className="tag">Objectifs</span><span className="tag">Planning</span><span className="tag">Récap</span></div>
            <span className="btn">Ouvrir JamsPlans <span>→</span></span>
          </a>

          <a className={"card c-permis" + (locked ? " locked" : "")} href="/permis" aria-label="Ouvrir JAMAL PERMIS" onClick={guard}>
            <span className="badge">En ligne</span>
            <div className="icon">🚗</div>
            <h2>JAMAL PERMIS</h2>
            <p>Apprends les questions de l'épreuve pratique du permis, avec correction et révision de tes erreurs jusqu'à l'examen.</p>
            <div className="tags"><span className="tag">Quiz</span><span className="tag">Corrigé</span><span className="tag">Historique</span></div>
            <span className="btn">Commencer <span>→</span></span>
          </a>

          <a className={"card c-langue" + (locked ? " locked" : "")} href="/langue" aria-label="Ouvrir Langue" onClick={guard}>
            <span className="badge">En ligne</span>
            <div className="icon">🌍</div>
            <h2>Langue</h2>
            <p>Apprends le vocabulaire en anglais, espagnol, mandarin et arabe : une question à la fois, avec correction et révision des mots ratés.</p>
            <div className="tags"><span className="tag">Anglais</span><span className="tag">Espagnol</span><span className="tag">Mandarin</span><span className="tag">Arabe</span></div>
            <span className="btn">Commencer <span>→</span></span>
          </a>

          <a className="card add" href="#nouveau" aria-label="Ajouter un module" onClick={(e) => soon(e, "Un nouveau module")}>
            <div className="plus">+</div>
            <h3>Un autre module ?</h3>
            <p style={{ margin: 0, fontSize: "13.5px" }}>Cet espace grandit avec toi.</p>
          </a>
        </section>

        <section className="values">
          <div className="value"><i>🧭</i><div><b>Un seul endroit</b><span>Tous tes outils d'apprentissage réunis, sans te perdre.</span></div></div>
          <div className="value"><i>📈</i><div><b>Progresse chaque jour</b><span>De petites actions régulières, suivies et récapitulées.</span></div></div>
          <div className="value"><i>📱</i><div><b>Partout avec toi</b><span>Sur téléphone comme sur ordinateur.</span></div></div>
        </section>

        <footer>Mon espace · Upgrade — fait pour avancer, un jour après l'autre.</footer>
      </div>

      <div className={"toast" + (toast ? " show" : "")} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
