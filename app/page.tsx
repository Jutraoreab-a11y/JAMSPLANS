"use client";

import { useEffect, useRef, useState } from "react";
import "./hub.css";

// Page d'accueil « Mon espace » : un bouton par module.
//  - JamsPlans    -> /jamsplans   (app/jamsplans/page.tsx)
//  - JAMAL PERMIS -> /permis      (public/permis.html, via rewrite dans next.config.js)
//  - Langue       -> pas encore branché (message « bientôt »)
// Pour brancher Langue : remplacer son href="#langue" par le vrai lien.
export default function Home() {
  const [today, setToday] = useState("");
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, []);

  function soon(e: React.MouseEvent, name: string) {
    e.preventDefault();
    setToast(name + " sera branché très bientôt.");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 2200);
  }

  return (
    <div className="hub">
      <div className="wrap">
        <div className="top">
          <div className="brand"><span className="brand-dot">M</span> Mon espace</div>
          <div className="today" suppressHydrationWarning>{today}</div>
        </div>

        <section className="hero">
          <span className="pill">⚡ Upgrade</span>
          <h1>Bienvenue dans <em>ton espace</em> pour progresser.</h1>
          <p>Discipline, permis, langues : tout ce que tu construis pour devenir meilleur chaque jour, au même endroit. Choisis un module et avance.</p>
        </section>

        <section className="grid" aria-label="Mes modules">
          <a className="card c-plans" href="/jamsplans" aria-label="Ouvrir JamsPlans">
            <span className="badge">En ligne</span>
            <div className="icon">🎯</div>
            <h2>JamsPlans</h2>
            <p>Ta discipline au quotidien : objectifs, planning, journée type, check-liste du soir et récap pour ne rien lâcher.</p>
            <div className="tags"><span className="tag">Objectifs</span><span className="tag">Planning</span><span className="tag">Récap</span></div>
            <span className="btn">Ouvrir JamsPlans <span>→</span></span>
          </a>

          <a className="card c-permis" href="/permis" aria-label="Ouvrir JAMAL PERMIS">
            <span className="badge">En ligne</span>
            <div className="icon">🚗</div>
            <h2>JAMAL PERMIS</h2>
            <p>Apprends les questions de l'épreuve pratique du permis, avec correction et révision de tes erreurs jusqu'à l'examen.</p>
            <div className="tags"><span className="tag">Quiz</span><span className="tag">Corrigé</span><span className="tag">Historique</span></div>
            <span className="btn">Commencer <span>→</span></span>
          </a>

          <a className="card c-langue" href="#langue" aria-label="Ouvrir Langue" onClick={(e) => soon(e, "Langue")}>
            <span className="badge soon">Bientôt</span>
            <div className="icon">🌍</div>
            <h2>Langue</h2>
            <p>Apprends une nouvelle langue pas à pas : vocabulaire, phrases utiles et pratique régulière pour tenir dans la durée.</p>
            <div className="tags"><span className="tag">Vocabulaire</span><span className="tag">Phrases</span><span className="tag">Pratique</span></div>
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
