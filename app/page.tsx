"use client";

import { useEffect, useRef } from "react";
import "./jamsplans.css";
import { JAMSPLANS_BODY_HTML } from "../components/jamsplans-markup";
import { initJamsPlansApp } from "../components/jamsplans-runtime";

// Cette page rend l'app JamsPlans telle que definie dans prototype.html :
// le balisage (jamsplans-markup.ts) et la logique (jamsplans-runtime.ts) en
// sont extraits tels quels, pour un rendu et un comportement identiques.
// Le useRef ci-dessous evite une double initialisation en developpement
// (React StrictMode invoque les effets deux fois).
export default function Page() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    initJamsPlansApp();
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: JAMSPLANS_BODY_HTML }} />;
}
