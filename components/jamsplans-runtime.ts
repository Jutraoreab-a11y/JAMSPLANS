// @ts-nocheck
// Ce fichier est une adaptation quasi verbatim du <script> de prototype.html,
// porte tel quel dans l'app Next.js pour un rendu et un comportement identiques.
// Non type-checke intentionnellement (voir @ts-nocheck) : la logique DOM ci-dessous
// suppose que le HTML de jamsplans-markup a deja ete injecte dans le document.
import { createClient } from "@supabase/supabase-js";

export function initJamsPlansApp() {
  // =========================================================
  // CONFIGURATION SUPABASE
  // =========================================================
  // 1. Créez un projet sur supabase.com et exécutez supabase/schema.sql
  //    (fourni avec le projet Next.js) dans le SQL Editor.
  // 2. Remplacez les deux valeurs ci-dessous par celles de
  //    Project Settings > API dans votre projet Supabase.
  // 3. Tant qu'elles ne sont pas renseignées, l'app tourne en mode démo
  //    local (données en mémoire, aucune sauvegarde) — pratique pour
  //    prévisualiser sans backend.
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

  // persistSession: true -> l'utilisateur reste connecté entre deux visites.
  // (Dans le prototype.html original ceci était mis à false pour eviter le
  // localStorage dans les apercus sandboxes ; ici c'est la vraie app, donc on
  // garde la session.)
  const supabaseClient = SUPABASE_CONFIGURED
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } })
    : null;

  // ---------------------------------------------------------
  // Couche d'accès aux données — un seul endroit à regarder pour
  // comprendre comment l'app parle à Supabase.
  // ---------------------------------------------------------
  const db = {
    async fetchAll(userId){
      const [objRes, routRes, agendaRes, logRes, profRes] = await Promise.all([
        supabaseClient.from("objectives").select("*").eq("user_id", userId).eq("is_active", true).order("created_at"),
        supabaseClient.from("routines").select("*").eq("user_id", userId).eq("is_active", true).order("day_of_week"),
        supabaseClient.from("agenda_tasks").select("*").eq("user_id", userId).eq("is_active", true).order("start_date"),
        supabaseClient.from("daily_logs").select("*").eq("user_id", userId).order("log_date", { ascending:false }),
        supabaseClient.from("profiles").select("*").eq("id", userId).maybeSingle(),
      ]);
      return {
        objectives: (objRes.data || []).map(mapObjectiveFromDb),
        routines: routRes.data || [],
        agendaTasks: agendaRes.data || [],
        dailyLogs: logRes.data || [],
        profile: profRes.data || null,
      };
    },
    async insertObjective(userId, payload){
      const { data, error } = await supabaseClient.from("objectives")
        .insert({ ...payload, user_id: userId }).select().single();
      if (error) throw error;
      return mapObjectiveFromDb(data);
    },
    async updateObjective(id, patch){
      const { data, error } = await supabaseClient.from("objectives")
        .update(patch).eq("id", id).select().single();
      if (error) throw error;
      return mapObjectiveFromDb(data);
    },
    async deleteObjective(id){
      const { error } = await supabaseClient.from("objectives").delete().eq("id", id);
      if (error) throw error;
    },
    async insertRoutine(userId, payload){
      const { data, error } = await supabaseClient.from("routines")
        .insert({ ...payload, user_id: userId }).select().single();
      if (error) throw error;
      return data;
    },
    async deleteRoutine(id){
      const { error } = await supabaseClient.from("routines").delete().eq("id", id);
      if (error) throw error;
    },
    async insertAgendaTask(userId, payload){
      const { data, error } = await supabaseClient.from("agenda_tasks")
        .insert({ ...payload, user_id: userId }).select().single();
      if (error) throw error;
      return data;
    },
    async deleteAgendaTask(id){
      const { error } = await supabaseClient.from("agenda_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    async upsertDailyLog(userId, payload, existingId){
      // Si on connaît déjà l'id du log existant (rechargé en mémoire), on met
      // à jour directement par id : c'est fiable dans tous les cas, sans
      // dépendre d'un ON CONFLICT.
      // Sinon (premier enregistrement du jour pour cette tâche), on upsert en
      // ciblant la contrainte "unique nulls not distinct" côté base (voir
      // schema.sql) : ATTENTION, ne pas cibler ici deux index uniques
      // PARTIELS séparés (routine / agenda_task) — Postgres refuse alors
      // l'upsert avec "no unique or exclusion constraint matching the ON
      // CONFLICT specification" (essayé, et ça cassait TOUS les
      // enregistrements). Une seule contrainte non partielle, une seule
      // liste de colonnes ici : les deux doivent rester en phase.
      if (existingId){
        const { data, error } = await supabaseClient.from("daily_logs")
          .update({ ...payload, user_id: userId })
          .eq("id", existingId)
          .select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabaseClient.from("daily_logs")
        .upsert({ ...payload, user_id: userId }, { onConflict: "user_id,routine_id,agenda_task_id,log_date" })
        .select().single();
      if (error) throw error;
      return data;
    },
    async upsertProfile(userId, patch){
      const { data, error } = await supabaseClient.from("profiles")
        .upsert({ id: userId, ...patch }).select().single();
      if (error) throw error;
      return data;
    },
  };

  // jsonb.history / current_year (snake_case en base) <-> currentYear / history (camelCase côté app)
  function mapObjectiveFromDb(row){
    return { ...row, currentYear: row.current_year, history: row.history || [], monthly_completions: row.monthly_completions || {} };
  }
  function mapObjectiveToDb(obj){
    return {
      title: obj.title,
      category: obj.category,
      start_date: obj.start_date,
      target_date: obj.target_date,
      weekly_hours_target: obj.weekly_hours_target,
      achieved: obj.achieved,
      current_year: obj.currentYear,
      history: obj.history,
      is_monthly: !!obj.is_monthly,
      monthly_completions: obj.monthly_completions || {},
      given_up: !!obj.given_up,
    };
  }

  // ---------------------------------------------------------
  // Couleurs par catégorie (distinctes des couleurs de statut
  // vert/orange/rouge, utilisées pour les badges du calendrier)
  // ---------------------------------------------------------
  const CATEGORY_COLORS = {
    "Étude": "#3B5BDB",
    "Travail": "#0E9394",
    "Sport": "#B0559C",
    "Langue": "#8E4EC6",
    "Agenda": "#B5651D",
    "Autre": "#6B6759",
  };
  const CATEGORY_FALLBACK_PALETTE = ["#B5651D", "#4E7A51", "#2C6E8C", "#946B4D", "#5B6EA8"];
  function categoryColor(category){
    if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
    // Catégorie personnalisée -> couleur stable dérivée du nom
    let hash = 0;
    for (let i=0; i<category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) % CATEGORY_FALLBACK_PALETTE.length;
    return CATEGORY_FALLBACK_PALETTE[Math.abs(hash) % CATEGORY_FALLBACK_PALETTE.length];
  }

  // Palette dédiée aux éléments de la journée type (Sommeil, Trajet,
  // Travail...) : contrairement à categoryColor() (pensée pour les
  // catégories d'objectifs, avec peu de teintes et donc des risques de
  // couleurs proches), chaque libellé distinct d'une même journée type
  // reçoit une couleur bien différenciée, dans l'ordre de première
  // apparition (par horaire de début) au sein de cette journée type.
  const DAY_BLOCK_PALETTE = ["#3B5BDB", "#0E9394", "#B0559C", "#C2410C", "#4E7A51", "#2C6E8C", "#946B4D", "#7C3AED", "#B5651D", "#1D7A8C"];
  function buildDayBlockColorMap(blocks){
    const sorted = [...blocks].sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));
    const map = {};
    let next = 0;
    sorted.forEach(b=>{
      if (!(b.label in map)){
        map[b.label] = DAY_BLOCK_PALETTE[next % DAY_BLOCK_PALETTE.length];
        next++;
      }
    });
    return map;
  }
  function categoryOfObjective(objectiveId){
    const obj = state.objectives.find(o=>o.id===objectiveId);
    return obj ? (obj.category || "Autre") : "Autre";
  }

  // Un bloc de journée type peut être rattaché à plusieurs objectifs à la
  // fois (ex : un créneau "Deep work" qui sert 2 objectifs). Compatible avec
  // les anciens blocs enregistrés avec un seul `objective_id` (avant le
  // passage au multi-sélection).
  function getBlockObjectiveIds(b){
    if (Array.isArray(b.objective_ids)) return b.objective_ids;
    return b.objective_id ? [b.objective_id] : [];
  }
  function getBlockLinkedObjectives(b){
    return getBlockObjectiveIds(b).map(id=>state.objectives.find(o=>o.id===id)).filter(Boolean);
  }

  // Calcule où on en est dans la fenêtre de temps d'un objectif (début -> fin).
  // Retourne null si les deux dates ne sont pas renseignées.
  function objectiveTimeProgress(obj){
    if (!obj.start_date || !obj.target_date) return null;
    const start = new Date(obj.start_date+"T00:00:00").getTime();
    const end = new Date(obj.target_date+"T00:00:00").getTime();
    const now = Date.now();
    if (end <= start) return null;

    // L'objectif n'a pas encore commencé : pas de "jours restants" tant qu'on
    // n'est pas dans la fenêtre, on affiche plutôt "commence dans X jours".
    if (now < start){
      const daysUntilStart = Math.ceil((start - now) / 86400000);
      return { pct: 0, daysLeft: Math.ceil((end - start) / 86400000), overdue: false, notStarted: true, daysUntilStart };
    }

    const pct = Math.round(Math.min(Math.max((now - start) / (end - start), 0), 1) * 100);
    const daysLeft = Math.ceil((end - now) / 86400000);
    return { pct, daysLeft, overdue: now > end, notStarted: false };
  }

  // % de discipline propre à un objectif : proportion de check-ins "verts"
  // parmi tous les jours cochés pour cet objectif (routines + agenda liés).
  function objectiveDisciplinePct(obj){
    const logs = state.dailyLogs.filter(l=>l.objective_id===obj.id);
    return computeDiscipline(logs);
  }

  // Bloc de progression partagé (liste principale + Archive) : le % de
  // temps écoulé reste toujours affiché, même après l'échéance — on ajoute
  // juste une mention "échéance dépassée" à côté plutôt que de le masquer.
  function objectiveProgressHtml(obj){
    const time = objectiveTimeProgress(obj);
    const disciplinePct = objectiveDisciplinePct(obj);
    const timeText = !time ? "" : time.notStarted
      ? `commence dans ${time.daysUntilStart} j`
      : `${time.pct}% du temps écoulé${time.overdue ? " · échéance dépassée" : ` · ${time.daysLeft} j restants`}`;
    const timeBar = time ? `
      <div class="obj-progress">
        <div class="obj-progress-track"><div class="obj-progress-fill" style="width:${time.pct}%; background:linear-gradient(90deg,#4C8FD6,#4CAF6D);"></div></div>
        <p class="obj-progress-text">${timeText}</p>
      </div>
    ` : "";
    const disciplineBar = `
      <div class="obj-progress">
        <div class="obj-progress-track"><div class="obj-progress-fill" style="width:${disciplinePct}%; background:linear-gradient(90deg,#A48CE8,#4CAF6D);"></div></div>
        <p class="obj-progress-text">${disciplinePct}% de discipline</p>
      </div>
    `;
    return timeBar + disciplineBar;
  }

  // Catégorie d'un log : celle de son objectif si présent, sinon "Agenda"
  // pour une tâche ponctuelle libre (sans grand objectif).
  function categoryForLog(log){
    if (log.objective_id) return categoryOfObjective(log.objective_id);
    if (log.agenda_task_id) return "Agenda";
    return "Autre";
  }

  // =========================================================
  // ÉTAT EN MÉMOIRE
  // En mode démo : quelques données de départ pour prévisualiser l'app.
  // En mode connecté : rempli par db.fetchAll() après authentification.
  // =========================================================
  // =========================================================
  // TOASTS — remplace les alert() bloquants par un message discret
  // =========================================================
  function showToast(message, type){
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast" + (type ? " " + type : "");
    toast.textContent = message;
    toast.style.pointerEvents = "auto";
    container.appendChild(toast);
    setTimeout(()=>{
      toast.classList.add("leaving");
      setTimeout(()=> toast.remove(), 220);
    }, 3200);
  }

  // Petit pictogramme ligne unique, réutilisé pour tous les états vides
  // (liste d'objectifs, agenda, check-in, calendrier...).
  function emptyStateIcon(){
    return `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="6" width="24" height="30" rx="3" stroke="var(--muted)" stroke-width="1.6"/>
      <path d="M14 4h12v5H14z" stroke="var(--muted)" stroke-width="1.6" stroke-linejoin="round"/>
      <line x1="13" y1="17" x2="27" y2="17" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="13" y1="23" x2="24" y2="23" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="13" y1="29" x2="20" y2="29" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
  }
  function emptyStateHtml(message){
    return `<div class="empty-state">${emptyStateIcon()}${escapeHtml(message)}</div>`;
  }

  const DAYS = [
    {value:1,label:"Lundi",short:"Lun"},
    {value:2,label:"Mardi",short:"Mar"},
    {value:3,label:"Mercredi",short:"Mer"},
    {value:4,label:"Jeudi",short:"Jeu"},
    {value:5,label:"Vendredi",short:"Ven"},
    {value:6,label:"Samedi",short:"Sam"},
    {value:0,label:"Dimanche",short:"Dim"},
  ];

  // Compteur simple + horodatage + suffixe aléatoire : évite qu'un rechargement
  // de page (qui remet le compteur à 0) ne fasse réattribuer un id déjà utilisé
  // par un ancien bloc/période de journée type d'une session précédente (ces
  // éléments sont gérés uniquement côté client, sans id généré par la base).
  let uid = 0;
  const nextId = () => "id-" + Date.now().toString(36) + "-" + (++uid) + "-" + Math.random().toString(36).slice(2, 7);

  function todayISO(){ return new Date().toISOString().slice(0,10); }
  // Vrai si dateStr est le dernier jour de son mois — sert à n'afficher les
  // objectifs mensuels (cochés une fois par mois) que ce jour-là.
  function isLastDayOfMonth(dateStr){
    const d = new Date(dateStr+"T00:00:00");
    const next = new Date(d);
    next.setDate(d.getDate()+1);
    return next.getMonth() !== d.getMonth();
  }

  // Format d'affichage demandé : "02 janv. 2026" / plages "02 janv. 2026 → 06 mai 2027"
  const MONTH_ABBR_FR = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
  function formatDateFr(dateStr){
    if (!dateStr) return "";
    const d = new Date(dateStr+"T00:00:00");
    return `${String(d.getDate()).padStart(2,"0")} ${MONTH_ABBR_FR[d.getMonth()]} ${d.getFullYear()}`;
  }
  function formatDateRangeFr(start, end){
    if (start && end) return `${formatDateFr(start)} → ${formatDateFr(end)}`;
    if (end) return `échéance ${formatDateFr(end)}`;
    if (start) return `depuis ${formatDateFr(start)}`;
    return "";
  }
  // Même chose sans l'année, pour les périodes qui se répètent chaque année
  // (seuls le jour et le mois comptent pour ces périodes-là).
  function formatDateFrNoYear(dateStr){
    const d = new Date(dateStr+"T00:00:00");
    return `${String(d.getDate()).padStart(2,"0")} ${MONTH_ABBR_FR[d.getMonth()]}`;
  }
  function formatAnnualRangeFr(start, end){
    return `${formatDateFrNoYear(start)} → ${formatDateFrNoYear(end)}`;
  }
  // Jours de la semaine (convention JS Date#getDay() : 0=Dimanche..6=Samedi),
  // affichés dans l'ordre français habituel Lun -> Dim.
  const WEEKDAY_LABELS_FR = { 0:"Dim", 1:"Lun", 2:"Mar", 3:"Mer", 4:"Jeu", 5:"Ven", 6:"Sam" };
  const WEEKDAY_ORDER_FR = [1,2,3,4,5,6,0];
  function formatWeekdaysFr(weekdays){
    if (!Array.isArray(weekdays) || weekdays.length === 0) return "";
    return WEEKDAY_ORDER_FR.filter(d=>weekdays.includes(d)).map(d=>WEEKDAY_LABELS_FR[d]).join(", ");
  }
  function isoDaysFromToday(offsetDays){
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0,10);
  }

  // Combine un champ "heures" + un champ "minutes" en un total décimal
  // d'heures (ex : 1h30 -> 1.5), et inversement pour ré-afficher une valeur
  // décimale existante dans les deux champs séparés.
  function hmToHours(hoursVal, minutesVal){
    const h = parseFloat(hoursVal) || 0;
    const m = parseFloat(minutesVal) || 0;
    return h + m / 60;
  }
  function hoursToHM(totalHours){
    const total = totalHours || 0;
    const h = Math.floor(total);
    const m = Math.round((total - h) * 60);
    return m >= 60 ? { h: h + 1, m: 0 } : { h, m };
  }

  // =========================================================
  // HORAIRES DE PRIÈRE — calculés via l'API publique Aladhan (gratuite, sans
  // clé) à partir des coordonnées de la ville choisie dans Profil. On
  // réutilise volontairement les mêmes villes que le fuseau horaire du
  // rappel du soir, avec leurs coordonnées approximatives.
  // =========================================================
  const PRAYER_CITIES = [
    { value: "", label: "Aucune (désactivé)" },
    { value: "Europe/Paris", label: "Paris (France)", lat: 48.8566, lon: 2.3522 },
    { value: "Europe/Brussels", label: "Bruxelles (Belgique)", lat: 50.8503, lon: 4.3517 },
    { value: "Europe/London", label: "Londres (Royaume-Uni)", lat: 51.5074, lon: -0.1278 },
    { value: "America/Montreal", label: "Montréal (Canada)", lat: 45.5019, lon: -73.5674 },
    { value: "Africa/Abidjan", label: "Abidjan (Côte d'Ivoire)", lat: 5.3600, lon: -4.0083 },
    { value: "Africa/Dakar", label: "Dakar (Sénégal)", lat: 14.7167, lon: -17.4677 },
    { value: "Indian/Reunion", label: "Saint-Denis (La Réunion)", lat: -20.8789, lon: 55.4481 },
  ];
  const PRAYER_NAMES = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  const PRAYER_LABEL_PREFIX = "🕌 ";

  function addMinutesToTime(hhmm, minutesToAdd){
    const [h, m] = hhmm.split(":").map(Number);
    const total = (h * 60 + m + minutesToAdd + 1440) % 1440;
    return String(Math.floor(total/60)).padStart(2,"0") + ":" + String(total%60).padStart(2,"0");
  }

  // Interroge l'API Aladhan pour les 5 horaires du jour à la ville donnée.
  // Retourne { Fajr, Dhuhr, Asr, Maghrib, Isha } au format "HH:MM", ou null
  // en cas d'échec (API indisponible, ville inconnue...).
  async function fetchPrayerTimings(cityValue, dateStr){
    const city = PRAYER_CITIES.find(c=>c.value===cityValue);
    if (!city || !city.value) return null;
    const [year, month, day] = dateStr.split("-");
    const url = `https://api.aladhan.com/v1/timings/${day}-${month}-${year}?latitude=${city.lat}&longitude=${city.lon}&method=3&timezonestring=${encodeURIComponent(city.value)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      const t = json?.data?.timings;
      if (!t) return null;
      const clean = (s)=> (s || "").split(" ")[0].slice(0,5);
      return {
        Fajr: clean(t.Fajr), Dhuhr: clean(t.Dhuhr), Asr: clean(t.Asr),
        Maghrib: clean(t.Maghrib), Isha: clean(t.Isha),
      };
    } catch(e){ return null; }
  }

  // Régénère les 5 tâches d'agenda "🕌 Fajr/Dhuhr/Asr/..." du jour pour
  // l'utilisateur, à partir de sa ville choisie dans Profil. Idempotent : si
  // les 5 tâches du jour existent déjà, ne refait pas l'appel API. Appelée
  // au chargement de l'app et juste après l'enregistrement d'une ville.
  async function syncPrayerTimesForToday(){
    if (!state.prayerEnabled || !state.prayerCity) return;
    const today = todayISO();
    const already = state.agendaTasks.filter(t=>t.start_date===today && (t.label||"").startsWith(PRAYER_LABEL_PREFIX));
    const alreadyNames = already.map(t=>t.label.slice(PRAYER_LABEL_PREFIX.length));
    const missingNames = PRAYER_NAMES.filter(n=>!alreadyNames.includes(n));
    if (missingNames.length === 0) { renderPrayerTimesToday(); return; }

    const timings = await fetchPrayerTimings(state.prayerCity, today);
    if (!timings) return;

    // Important : on ne supprime jamais une prière déjà créée aujourd'hui —
    // l'utilisateur a pu déjà cocher son statut dans la Check-liste, et la
    // supprimer casserait ce check-in (erreur d'enregistrement). On complète
    // seulement les prières manquantes (premier lancement du jour, ou appel
    // précédent incomplet).
    for (const name of missingNames){
      const start = timings[name];
      if (!start) continue;
      const draft = {
        start_date: today, end_date: today, label: PRAYER_LABEL_PREFIX + name,
        objective_id: null, is_priority: false,
        // planned_hours volontairement non-nul (≈3 min) : ainsi, cocher
        // "Fait" avec la durée par défaut compte bien comme réalisé partout
        // où le calcul se base sur actual_hours > 0 (calendrier, discipline,
        // rappel du soir), sans fausser sensiblement les totaux d'heures.
        planned_hours: 0.05,
        planning_start: start, planning_end: addMinutesToTime(start, 15),
      };
      if (SUPABASE_CONFIGURED){
        try { state.agendaTasks.push(await db.insertAgendaTask(state.userId, draft)); }
        catch(e){ /* pas grave, on retentera au prochain chargement */ }
      } else {
        state.agendaTasks.push({ id: nextId(), ...draft });
      }
    }
    renderAgenda();
    renderCheckin();
    renderPrayerTimesToday();
  }

  // =========================================================
  // MÉTÉO DU JOUR — un simple conseil en une phrase (pas un vrai tableau de
  // bord météo), à partir de la même ville que les horaires de prière et de
  // l'API publique gratuite Open-Meteo (sans clé). But volontairement
  // minimaliste : "il pleut, prends une veste et un parapluie", pas plus.
  // =========================================================
  let weatherTipDate = null; // évite de rappeler l'API plusieurs fois pour le même jour

  // Icône selon le code météo WMO (Open-Meteo) : reflète directement le ciel
  // (soleil, nuages, pluie...), indépendamment du conseil textuel ci-dessous
  // qui lui tient aussi compte de la température et du vent.
  function weatherIconForCode(code){
    if (code >= 95) return "⛈️";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄️";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "🌧️";
    if (code >= 51 && code <= 57) return "🌦️";
    if (code === 45 || code === 48) return "🌫️";
    if (code === 0) return "☀️";
    if (code === 1) return "🌤️";
    if (code === 2) return "⛅";
    if (code === 3) return "☁️";
    return "🌡️";
  }

  function weatherAdviceSentence(code, tempC, precipitationMm, windKmh){
    // Codes météo WMO (norme utilisée par Open-Meteo) regroupés en grandes
    // familles : on ne cherche pas la précision, juste un conseil utile.
    const isThunder = code >= 95;
    const isSnow = (code >= 71 && code <= 77) || code === 85 || code === 86;
    const isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precipitationMm > 0;
    const isFog = code === 45 || code === 48;
    const isWindy = windKmh >= 40;
    const isHot = tempC >= 30;
    const isCold = tempC <= 12;

    if (isThunder) return "Orages annoncés aujourd'hui : évite les déplacements inutiles et reste à l'abri.";
    if (isSnow) return "Il neige aujourd'hui : couvre-toi bien et fais attention en te déplaçant.";
    if (isRain) return "Il pleut aujourd'hui : prends une veste et un parapluie.";
    if (isFog) return "Brouillard aujourd'hui : sois prudent sur la route.";
    if (isWindy) return "Il y a du vent aujourd'hui : prends une veste.";
    if (isHot) return "Il fait chaud aujourd'hui : pense à boire de l'eau et à te protéger du soleil.";
    if (isCold) return "Il fait froid aujourd'hui : couvre-toi bien.";
    // Rien de notable : pas de conseil affiché du tout plutôt qu'une phrase
    // de remplissage (voir renderWeatherTip).
    return "";
  }

  async function fetchWeatherAdvice(cityValue){
    const city = PRAYER_CITIES.find(c=>c.value===cityValue);
    if (!city || !city.value) return null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=${encodeURIComponent(city.value)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      const cur = json?.current;
      if (!cur) return null;
      return {
        icon: weatherIconForCode(cur.weather_code),
        tempC: Math.round(cur.temperature_2m),
        sentence: weatherAdviceSentence(cur.weather_code, cur.temperature_2m, cur.precipitation, cur.wind_speed_10m),
      };
    } catch(e){ return null; }
  }

  // Récupère et affiche le conseil météo du jour dans Check-liste — au plus
  // une fois par jour (rien à voir avec les tâches, donc rien n'est stocké
  // en base : c'est recalculé côté client à chaque nouvelle journée).
  async function renderWeatherTip(){
    const box = document.getElementById("weather-tip");
    if (!box) return;
    if (!state.prayerCity){ box.innerHTML = ""; return; }
    const today = todayISO();
    if (weatherTipDate === today) return;
    const advice = await fetchWeatherAdvice(state.prayerCity);
    if (advice){
      weatherTipDate = today;
      // Pas de phrase (journée calme) -> rien à afficher du tout, plutôt
      // qu'un message de remplissage sans intérêt.
      box.innerHTML = advice.sentence
        ? `<span style="font-size:18px; vertical-align:middle;">${advice.icon}</span> <strong class="mono">${advice.tempC}°C</strong> ${escapeHtml(advice.sentence)}`
        : "";
    }
  }

  // Petit récapitulatif texte des horaires du jour, affiché dans Profil.
  function renderPrayerTimesToday(){
    const box = document.getElementById("prayer-times-today");
    if (!box) return;
    if (!state.prayerEnabled){ box.textContent = ""; return; }
    if (!state.prayerCity){ box.textContent = ""; return; }
    const today = todayISO();
    const todays = state.agendaTasks.filter(t=>t.start_date===today && (t.label||"").startsWith(PRAYER_LABEL_PREFIX));
    if (todays.length === 0){ box.textContent = "Calcul des horaires du jour…"; return; }
    const order = PRAYER_NAMES;
    const sorted = [...todays].sort((a,b)=>order.indexOf(a.label.slice(PRAYER_LABEL_PREFIX.length)) - order.indexOf(b.label.slice(PRAYER_LABEL_PREFIX.length)));
    box.textContent = "Aujourd'hui : " + sorted.map(t=>`${t.label.slice(PRAYER_LABEL_PREFIX.length)} : ${t.planning_start}`).join(" · ");
  }

  // =========================================================
  // DONNÉES DE DÉMO (mode local uniquement) — toutes calées en relatif
  // par rapport à "aujourd'hui" pour rester cohérentes quel que soit le
  // jour d'ouverture du fichier. Sert à voir tous les calculs (scores,
  // jauges, contribution-graph, archive...) avec un historique réaliste.
  // =========================================================
  const demoObjectives = [
    { id: "obj-1", title: "Valider le DCG", category: "Étude", start_date: isoDaysFromToday(-190), target_date: isoDaysFromToday(270), weekly_hours_target: 10, achieved: false, history: [], currentYear: new Date(isoDaysFromToday(270)).getFullYear() },
    { id: "obj-2", title: "Courir un semi-marathon", category: "Sport", start_date: isoDaysFromToday(-160), target_date: isoDaysFromToday(-20), weekly_hours_target: 4, achieved: true, history: [], currentYear: new Date(isoDaysFromToday(-20)).getFullYear() },
    { id: "obj-3", title: "Apprendre l'espagnol (B2)", category: "Langue", start_date: isoDaysFromToday(-400), target_date: isoDaysFromToday(-60), weekly_hours_target: 3, achieved: false, history: [], currentYear: new Date(isoDaysFromToday(-60)).getFullYear() },
    { id: "obj-4", title: "Décrocher une promotion", category: "Travail", start_date: isoDaysFromToday(-220), target_date: isoDaysFromToday(-100), weekly_hours_target: 8, achieved: true, history: [], currentYear: new Date(isoDaysFromToday(-100)).getFullYear() },
  ];

  const demoRoutines = [
    { id: "r-1", objective_id: "obj-1", day_of_week: 1, label: "Comptabilité", planned_hours: 2, is_priority: true, start_time: "18:00", end_time: "20:00" },
    { id: "r-2", objective_id: "obj-1", day_of_week: 2, label: "Droit fiscal", planned_hours: 2, is_priority: false, start_time: "18:00", end_time: "20:00" },
    { id: "r-3", objective_id: "obj-1", day_of_week: 3, label: "Analyse financière", planned_hours: 2, is_priority: false, start_time: "18:00", end_time: "20:00" },
    { id: "r-4", objective_id: "obj-2", day_of_week: 2, label: "Sortie course", planned_hours: 1, is_priority: false },
    { id: "r-5", objective_id: "obj-2", day_of_week: 4, label: "Sortie course", planned_hours: 1, is_priority: false },
    { id: "r-6", objective_id: "obj-2", day_of_week: 6, label: "Sortie longue", planned_hours: 1.5, is_priority: true },
    { id: "r-7", objective_id: "obj-3", day_of_week: 0, label: "Conversation espagnole", planned_hours: 1, is_priority: false },
    { id: "r-8", objective_id: "obj-4", day_of_week: 4, label: "Deep work projet", planned_hours: 3, is_priority: true },
  ];

  const demoAgendaTasks = [
    { id: "ag-1", start_date: isoDaysFromToday(2), end_date: isoDaysFromToday(2), label: "Rendez-vous dentiste", planned_hours: 1, objective_id: null, is_priority: true, planning_start: null, planning_end: null },
    { id: "ag-2", start_date: isoDaysFromToday(5), end_date: isoDaysFromToday(7), label: "Révisions examen blanc DCG", planned_hours: 2, objective_id: "obj-1", is_priority: true, planning_start: "18:30", planning_end: "20:00" },
    { id: "ag-3", start_date: isoDaysFromToday(12), end_date: isoDaysFromToday(13), label: "Weekend randonnée", planned_hours: 4, objective_id: null, is_priority: false, planning_start: null, planning_end: null },
  ];

  // Génère un historique de check-ins plausible pour chaque routine, sur la
  // fenêtre de son objectif (bornée aux ~200 derniers jours). Biaisé un peu
  // plus positivement sur la dernière semaine pour illustrer un vrai streak.
  function generateDemoDailyLogs(routines, objectives){
    const logs = [];
    let counter = 1;
    const genStart = isoDaysFromToday(-200);
    const genEnd = todayISO();

    routines.forEach(routine=>{
      const obj = objectives.find(o=>o.id===routine.objective_id);
      if (!obj) return;
      const windowStart = obj.start_date > genStart ? obj.start_date : genStart;
      const windowEnd = (obj.target_date && obj.target_date < genEnd) ? obj.target_date : genEnd;
      if (windowEnd < windowStart) return;

      const cursor = new Date(windowStart+"T00:00:00");
      const endDate = new Date(windowEnd+"T00:00:00");
      while (cursor <= endDate){
        if (cursor.getDay() === routine.day_of_week){
          const dateStr = cursor.toISOString().slice(0,10);
          const daysBeforeToday = Math.round((new Date(genEnd+"T00:00:00") - cursor) / 86400000);
          const recentBoost = daysBeforeToday >= 0 && daysBeforeToday <= 6;
          const roll = Math.random();
          let status, actual;
          if (roll < (recentBoost ? 0.85 : 0.60)){
            status = "done"; actual = routine.planned_hours;
          } else if (roll < (recentBoost ? 0.96 : 0.82)){
            status = "partial"; actual = Math.round(routine.planned_hours * (0.4 + Math.random()*0.4) * 4)/4;
          } else {
            status = "not_done"; actual = 0;
          }
          logs.push({
            id: "log-"+(counter++),
            routine_id: routine.id, agenda_task_id: null, objective_id: routine.objective_id,
            log_date: dateStr, status, planned_hours: routine.planned_hours, actual_hours: actual,
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return logs;
  }

  // URL fixe du scénario Make.com ("Rappel du soir - Envoi mail") : ce n'est
  // plus un réglage éditable par l'utilisateur dans Profil (un seul scénario
  // existe pour l'instant), donc elle est simplement codée en dur ici.
  const JAMSPLANS_MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/teu8k7bx0qxdrp92xpgi5v052dvbq89w";

  const state = {
    userId: null,
    profile: {
      // "Abdoulaye" n'est qu'un exemple pour le mode démo local (sans Supabase) ;
      // avec un vrai compte, le prénom reste vide tant que l'utilisateur ne l'a
      // pas renseigné dans Profil.
      firstName: SUPABASE_CONFIGURED ? "" : "Abdoulaye",
      email: "",
      password: "",
    },
    objectives: SUPABASE_CONFIGURED ? [] : demoObjectives,
    routines: SUPABASE_CONFIGURED ? [] : demoRoutines,
    dailyLogs: SUPABASE_CONFIGURED ? [] : generateDemoDailyLogs(demoRoutines, demoObjectives),
    agendaTasks: SUPABASE_CONFIGURED ? [] : demoAgendaTasks,
    selectedPlanningObjective: SUPABASE_CONFIGURED ? null : "obj-1",
    selectedDashboardObjective: "all",
    selectedAppYear: String(new Date().getFullYear()),
    dashboardRange: "week",
    dashboardYear: new Date().getFullYear(),
    dashboardMonth: new Date().getMonth(), // 0-11
    reminder: { enabled: false, time: "20:00", timezone: "Europe/Paris", webhookUrl: JAMSPLANS_MAKE_WEBHOOK_URL, channelEmail: true, channelSms: false },
    prayerCity: "",
    prayerEnabled: false,
    weeklyLimits: SUPABASE_CONFIGURED ? {} : { "Étude": 15, "Travail": 40, "Sport": 8 },
    // Plusieurs journées type possibles, chacune valable sur une période
    // (ou "toujours" si period_start/period_end sont vides). Celle qui
    // s'applique à une date donnée est retrouvée via getTemplateForDate().
    dayTemplates: SUPABASE_CONFIGURED ? [] : [
      {
        id: "tpl-default", name: "Par défaut", period_start: null, period_end: null,
        blocks: [
          { id: "dt-1", start: "23:00", end: "08:00", label: "Sommeil" },
          { id: "dt-2", start: "09:00", end: "10:00", label: "Trajet" },
          { id: "dt-3", start: "10:00", end: "12:00", label: "Travail" },
          { id: "dt-4", start: "13:00", end: "18:00", label: "Travail" },
        ],
      },
      {
        id: "tpl-hiver", name: "Hiver studieux", period_start: "2026-01-01", period_end: "2026-03-31",
        blocks: [
          { id: "dt-5", start: "22:30", end: "06:30", label: "Sommeil" },
          { id: "dt-6", start: "06:30", end: "07:30", label: "Sport" },
          { id: "dt-7", start: "09:00", end: "12:00", label: "Travail" },
          { id: "dt-8", start: "13:00", end: "17:00", label: "Travail" },
        ],
      },
    ],
    // "Par défaut" (période sans dates) n'est plus sélectionnable depuis
    // l'interface : seules les périodes datées ("+ Nouvelle période")
    // apparaissent désormais. On démarre donc sur une période datée en mode
    // démo ; en mode Supabase, la vraie sélection est recalculée après le
    // chargement du profil (cf. enterApp()).
    activeDayTemplateId: SUPABASE_CONFIGURED ? null : "tpl-hiver",
  };

  // =========================================================
  // LOGIQUE DE SCORING (miroir de lib/calculations.ts)
  // =========================================================
  function getColorCode(log){
    if (log.excused_reason) return "excused";
    if (log.status === "not_done" || log.actual_hours <= 0) return "red";
    if (log.status === "done" && log.planned_hours > 0 && log.actual_hours >= log.planned_hours) return "green";
    if (log.planned_hours === 0 && log.actual_hours > 0) return "green";
    return "orange";
  }

  const COLOR_HEX = { green:"var(--green)", orange:"var(--orange)", red:"var(--red)", empty:"var(--empty)", excused:"var(--muted)" };

  function excuseLabel(reason){
    if (reason === "malade") return "Malade";
    if (reason === "conges_payes") return "Congés payés";
    if (reason) return reason; // raison personnalisée ("Autre")
    return "Exception";
  }

  // Les jours en exception (malade / congés payés) ne comptent ni pour ni
  // contre la discipline : on les retire simplement du dénominateur.
  function computeDiscipline(logs){
    const counted = logs.filter(l => !l.excused_reason);
    if (counted.length === 0) return 0;
    const green = counted.filter(l => getColorCode(l) === "green").length;
    return Math.round((green / counted.length) * 1000) / 10;
  }

  function computePerformance(logs){
    const counted = logs.filter(l => !l.excused_reason);
    const planned = counted.reduce((s,l)=>s+l.planned_hours,0);
    const actual = counted.reduce((s,l)=>s+l.actual_hours,0);
    if (planned === 0) return 0;
    return Math.round((actual/planned)*1000)/10;
  }

  function computeHoursRatio(logs){
    const counted = logs.filter(l => !l.excused_reason);
    const planned = counted.reduce((s,l)=>s+l.planned_hours,0);
    const actual = counted.reduce((s,l)=>s+l.actual_hours,0);
    const ratio = planned > 0 ? Math.min(actual/planned, 1.5) : 0;
    return { planned, actual, ratio };
  }

  function computeStreak(logs){
    if (logs.length === 0) return 0;
    const sorted = [...logs].sort((a,b)=> new Date(b.log_date) - new Date(a.log_date));
    let streak = 0, cursor = null;
    for (const log of sorted){
      const d = new Date(log.log_date+"T00:00:00");
      // Un jour en exception ne casse pas la série : on l'ignore et on continue.
      if (log.excused_reason){
        if (cursor !== null){
          const expected = new Date(cursor); expected.setDate(expected.getDate()-1);
          if (d.getTime() !== expected.getTime()) break;
          cursor = d;
        }
        continue;
      }
      if (cursor === null){
        if (getColorCode(log) !== "green") break;
        streak = 1; cursor = d; continue;
      }
      const expected = new Date(cursor); expected.setDate(expected.getDate()-1);
      if (d.getTime() !== expected.getTime()) break;
      if (getColorCode(log) !== "green") break;
      streak += 1; cursor = d;
    }
    return streak;
  }

  // =========================================================
  // NAVIGATION ENTRE ONGLETS
  // =========================================================
  document.querySelectorAll(".tab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll("section.tab").forEach(s=>s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    });
  });

  document.querySelectorAll(".target-switch-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".target-switch-btn").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".target-subview").forEach(s=>s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("subview-"+btn.dataset.subview).classList.add("active");
    });
  });

  // =========================================================
  // ONGLET 1 : OBJECTIFS & PLANNING
  // =========================================================
  document.getElementById("obj-category").addEventListener("change", e=>{
    document.getElementById("obj-category-custom").style.display = e.target.value === "__custom" ? "block" : "none";
  });

  // Objectif en cours de modification (bouton "Modifier" de la liste) — null
  // quand le formulaire sert à créer un nouvel objectif.
  let editingObjectiveId = null;
  const STANDARD_CATEGORIES = ["Étude", "Travail", "Sport", "Langue", "Autre"];

  function resetObjectiveForm(){
    editingObjectiveId = null;
    document.getElementById("obj-title").value = "";
    document.getElementById("obj-start-date").value = "";
    document.getElementById("obj-date").value = "";
    document.getElementById("obj-no-end-date").checked = false;
    document.getElementById("obj-date-wrap").style.display = "";
    document.getElementById("obj-hours").value = "10";
    document.getElementById("obj-minutes").value = "0";
    document.getElementById("obj-monthly").checked = false;
    document.getElementById("obj-hours-wrap").style.display = "";
    document.getElementById("obj-category-custom").value = "";
    document.getElementById("obj-category-custom").style.display = "none";
    document.getElementById("obj-category").value = "Étude";
    document.getElementById("obj-submit-btn").textContent = "+ Ajouter";
    document.getElementById("obj-cancel-edit-btn").style.display = "none";
  }

  // "Objectif mensuel" (ex : "Mettre 1000€ de côté") : à cocher une seule
  // fois par mois, le dernier jour, plutôt que suivi en heures/semaine —
  // le champ "Volume cible" n'a alors plus de sens et est masqué.
  document.getElementById("obj-monthly").addEventListener("change", e=>{
    document.getElementById("obj-hours-wrap").style.display = e.target.checked ? "none" : "";
  });

  // "Tous les jours" : masque la date de fin (l'objectif devient permanent,
  // sans échéance, jusqu'à ce qu'on clique sur "Arrêter" dans la liste).
  document.getElementById("obj-no-end-date").addEventListener("change", e=>{
    document.getElementById("obj-date-wrap").style.display = e.target.checked ? "none" : "";
    if (e.target.checked) document.getElementById("obj-date").value = "";
  });

  function startEditingObjective(obj){
    editingObjectiveId = obj.id;
    document.getElementById("obj-title").value = obj.title;
    const isStandard = STANDARD_CATEGORIES.includes(obj.category);
    document.getElementById("obj-category").value = isStandard ? obj.category : "__custom";
    document.getElementById("obj-category-custom").style.display = isStandard ? "none" : "block";
    document.getElementById("obj-category-custom").value = isStandard ? "" : (obj.category || "");
    document.getElementById("obj-start-date").value = obj.start_date || "";
    document.getElementById("obj-date").value = obj.target_date || "";
    document.getElementById("obj-no-end-date").checked = !obj.target_date;
    document.getElementById("obj-date-wrap").style.display = obj.target_date ? "" : "none";
    const objHM = hoursToHM(obj.weekly_hours_target);
    document.getElementById("obj-hours").value = objHM.h;
    document.getElementById("obj-minutes").value = objHM.m;
    document.getElementById("obj-monthly").checked = !!obj.is_monthly;
    document.getElementById("obj-hours-wrap").style.display = obj.is_monthly ? "none" : "";
    document.getElementById("obj-submit-btn").textContent = "Enregistrer les modifications";
    document.getElementById("obj-cancel-edit-btn").style.display = "inline-block";
    document.querySelectorAll(".target-switch-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".target-subview").forEach(s=>s.classList.remove("active"));
    document.querySelector('.target-switch-btn[data-subview="objectif"]').classList.add("active");
    document.getElementById("subview-objectif").classList.add("active");
    document.getElementById("obj-title").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.getElementById("obj-cancel-edit-btn").addEventListener("click", resetObjectiveForm);

  document.getElementById("objective-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const title = document.getElementById("obj-title").value.trim();
    if (!title) return;
    const categorySelect = document.getElementById("obj-category").value;
    const category = categorySelect === "__custom"
      ? (document.getElementById("obj-category-custom").value.trim() || "Autre")
      : categorySelect;
    const startDate = document.getElementById("obj-start-date").value;
    const noEndDate = document.getElementById("obj-no-end-date").checked;
    const date = noEndDate ? "" : document.getElementById("obj-date").value;
    const isMonthly = document.getElementById("obj-monthly").checked;
    const hours = isMonthly ? 0 : hmToHours(document.getElementById("obj-hours").value, document.getElementById("obj-minutes").value);
    const year = date ? new Date(date+"T00:00:00").getFullYear() : new Date().getFullYear();

    if (editingObjectiveId){
      const existing = state.objectives.find(o=>o.id===editingObjectiveId);
      if (!existing) { resetObjectiveForm(); return; }
      const patch = { title, category, start_date: startDate || null, target_date: date || null, weekly_hours_target: hours, is_monthly: isMonthly };
      if (SUPABASE_CONFIGURED){
        try {
          const updated = await db.updateObjective(editingObjectiveId, mapObjectiveToDb({ ...existing, ...patch }));
          Object.assign(existing, updated);
        } catch(err){ showToast("Erreur lors de la modification : " + err.message, "error"); return; }
      } else {
        Object.assign(existing, patch);
      }
      resetObjectiveForm();
      renderAll();
      return;
    }

    const draft = { title, category, start_date: startDate || null, target_date: date || null, weekly_hours_target: hours, achieved: false, history: [], currentYear: year, is_monthly: isMonthly, monthly_completions: {} };

    if (SUPABASE_CONFIGURED){
      try {
        const created = await db.insertObjective(state.userId, mapObjectiveToDb(draft));
        state.objectives.push(created);
      } catch(err){ showToast("Erreur lors de la création de l'objectif : " + err.message, "error"); return; }
    } else {
      state.objectives.push({ id: nextId(), ...draft });
    }

    resetObjectiveForm();
    renderPlanning();
  });

  async function deleteObjective(id){
    if (SUPABASE_CONFIGURED){
      try { await db.deleteObjective(id); }
      catch(err){ showToast("Erreur lors de la suppression : " + err.message, "error"); return; }
    }
    state.objectives = state.objectives.filter(o=>o.id!==id);
    state.routines = state.routines.filter(r=>r.objective_id!==id);
    if (state.selectedPlanningObjective === id) state.selectedPlanningObjective = null;
    renderAll();
  }

  // Poursuit un objectif non atteint sur l'année suivante (N -> N+1).
  // L'objectif garde le même id : ses routines et tout son historique de
  // check-ins (daily_logs) restent donc intacts et consultables dans Résultat,
  // filtrables par année via le sélecteur d'année.
  async function continueObjectiveToNextYear(id){
    const obj = state.objectives.find(o=>o.id===id);
    if (!obj || obj.achieved) return;

    const fromYear = obj.currentYear;
    const toYear = fromYear + 1;
    const newHistory = [...obj.history, { fromYear, toYear }];
    const shiftYear = (dateStr)=>{
      if (!dateStr) return dateStr;
      const d = new Date(dateStr+"T00:00:00");
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().slice(0,10);
    };
    const newTargetDate = shiftYear(obj.target_date);
    const newStartDate = shiftYear(obj.start_date);

    if (SUPABASE_CONFIGURED){
      try {
        const updated = await db.updateObjective(id, { current_year: toYear, history: newHistory, target_date: newTargetDate, start_date: newStartDate });
        Object.assign(obj, updated);
      } catch(err){ showToast("Erreur lors du report : " + err.message, "error"); return; }
    } else {
      obj.history = newHistory;
      obj.currentYear = toYear;
      obj.target_date = newTargetDate;
      obj.start_date = newStartDate;
    }
    renderAll();
  }

  // Arrête un objectif "Tous les jours" (permanent, sans date de fin) : fixe
  // la date de fin à aujourd'hui et le marque atteint, pour qu'il rejoigne
  // l'archive en Réussite sans rien perdre de l'historique (routines,
  // check-ins, heures) déjà enregistré jusqu'à ce jour.
  async function stopOngoingObjective(id){
    const obj = state.objectives.find(o=>o.id===id);
    if (!obj) return;
    const today = todayISO();
    if (SUPABASE_CONFIGURED){
      try {
        const updated = await db.updateObjective(id, { target_date: today, achieved: true });
        Object.assign(obj, updated);
      } catch(err){ showToast("Erreur : " + err.message, "error"); return; }
    } else {
      obj.target_date = today;
      obj.achieved = true;
    }
    renderAll();
  }

  // Quand un objectif est réussi, arrêté ou en échec (échéance dépassée),
  // on demande si on veut le poursuivre à une nouvelle étape/niveau ou sur
  // une nouvelle période. Si oui, un formulaire permet de changer le titre,
  // le niveau (volume cible) et la plage de dates : un nouvel objectif est
  // créé avec ces réglages, l'ancien restant tel quel dans l'archive.
  function openContinueObjectivePrompt(obj, verb){
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <h3 style="font-size:15px; margin-bottom:8px;">Objectif ${verb} : « ${escapeHtml(obj.title)} »</h3>
        <p class="label">Voulez-vous poursuivre cet objectif à une nouvelle étape (nouveau niveau) ou sur une nouvelle période ?</p>
        <div style="display:flex; gap:10px; margin-top:14px;">
          <button type="button" class="btn" id="continue-obj-yes">Oui</button>
          <button type="button" class="continue-btn" id="continue-obj-no">Non</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = ()=> overlay.remove();
    overlay.addEventListener("click", e=>{ if (e.target === overlay) close(); });
    overlay.querySelector("#continue-obj-no").addEventListener("click", close);
    overlay.querySelector("#continue-obj-yes").addEventListener("click", ()=>{
      close();
      openContinueObjectiveForm(obj);
    });
  }

  function openContinueObjectiveForm(obj){
    const objHM = hoursToHM(obj.weekly_hours_target);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <h3 style="font-size:15px; margin-bottom:8px;">Nouvelle étape pour « ${escapeHtml(obj.title)} »</h3>
        <p class="label">Titre, niveau et période sont modifiables : c'est reparti pour un nouvel objectif.</p>
        <form id="continue-obj-form" style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
          <div>
            <label class="field-label" for="continue-obj-title">Titre</label>
            <input id="continue-obj-title" value="${escapeHtml(obj.title)}" required />
          </div>
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer;">
            <input type="checkbox" id="continue-obj-monthly" style="width:auto;" ${obj.is_monthly ? "checked" : ""} /> Objectif mensuel (à cocher 1x/mois, le dernier jour)
          </label>
          <div id="continue-obj-hours-wrap" style="display:${obj.is_monthly ? "none" : "flex"}; gap:8px; align-items:center;">
            <div>
              <label class="field-label" for="continue-obj-hours">Nouveau niveau (volume cible)</label>
              <div class="hours-input">
                <input id="continue-obj-hours" type="number" min="0" step="1" value="${objHM.h}" />
                <span class="muted" style="font-size:12px;">h</span>
                <input id="continue-obj-minutes" type="number" min="0" max="59" step="5" value="${objHM.m}" />
                <span class="muted" style="font-size:12px;">min /sem</span>
              </div>
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <div style="flex:1;">
              <label class="field-label" for="continue-obj-start">Début</label>
              <input id="continue-obj-start" type="date" value="${todayISO()}" />
            </div>
            <div style="flex:1;">
              <label class="field-label" for="continue-obj-end">Échéance</label>
              <input id="continue-obj-end" type="date" />
            </div>
          </div>
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer;">
            <input type="checkbox" id="continue-obj-no-end" style="width:auto;" /> Tous les jours (sans échéance)
          </label>
          <div style="display:flex; gap:10px; margin-top:6px;">
            <button type="submit" class="btn">C'est reparti</button>
            <button type="button" class="continue-btn" id="continue-obj-cancel">Annuler</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = ()=> overlay.remove();
    overlay.addEventListener("click", e=>{ if (e.target === overlay) close(); });
    overlay.querySelector("#continue-obj-cancel").addEventListener("click", close);
    overlay.querySelector("#continue-obj-monthly").addEventListener("change", e=>{
      overlay.querySelector("#continue-obj-hours-wrap").style.display = e.target.checked ? "none" : "flex";
    });
    overlay.querySelector("#continue-obj-no-end").addEventListener("change", e=>{
      overlay.querySelector("#continue-obj-end").disabled = e.target.checked;
      if (e.target.checked) overlay.querySelector("#continue-obj-end").value = "";
    });
    overlay.querySelector("#continue-obj-form").addEventListener("submit", async e=>{
      e.preventDefault();
      const title = overlay.querySelector("#continue-obj-title").value.trim();
      if (!title) return;
      const isMonthly = overlay.querySelector("#continue-obj-monthly").checked;
      const noEnd = overlay.querySelector("#continue-obj-no-end").checked;
      const startDate = overlay.querySelector("#continue-obj-start").value || todayISO();
      const endDate = noEnd ? "" : overlay.querySelector("#continue-obj-end").value;
      const hours = isMonthly ? 0 : hmToHours(overlay.querySelector("#continue-obj-hours").value, overlay.querySelector("#continue-obj-minutes").value);
      const year = endDate ? new Date(endDate+"T00:00:00").getFullYear() : new Date(startDate+"T00:00:00").getFullYear();
      const draft = {
        title, category: obj.category, start_date: startDate || null, target_date: endDate || null,
        weekly_hours_target: hours, achieved: false, history: [],
        currentYear: year, is_monthly: isMonthly, monthly_completions: {}
      };
      if (SUPABASE_CONFIGURED){
        try {
          const created = await db.insertObjective(state.userId, mapObjectiveToDb(draft));
          state.objectives.push(created);
        } catch(err){ showToast("Erreur lors de la création de la suite : " + err.message, "error"); return; }
      } else {
        state.objectives.push({ id: nextId(), ...draft });
      }
      close();
      renderAll();
      showToast("Nouvelle étape créée pour « " + title + " ».", "success");
    });
  }

  // =========================================================
  // AGENDA : tâches ponctuelles à une date précise
  // =========================================================
  document.getElementById("agenda-add-to-planning").addEventListener("change", e=>{
    document.getElementById("agenda-planning-slot").style.display = e.target.checked ? "flex" : "none";
  });

  document.getElementById("agenda-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const startDate = document.getElementById("agenda-start-date").value || todayISO();
    const endDate = document.getElementById("agenda-end-date").value || startDate;
    const label = document.getElementById("agenda-label").value.trim();
    if (!label) return;
    if (endDate < startDate){
      showToast("La date de fin ne peut pas être avant la date de début.", "error");
      return;
    }
    const objectiveId = document.getElementById("agenda-objective").value || null;
    const hours = hmToHours(document.getElementById("agenda-hours").value, document.getElementById("agenda-minutes").value);
    const isPriority = document.getElementById("agenda-priority").checked;
    const addToPlanning = document.getElementById("agenda-add-to-planning").checked;

    let planningStart = null, planningEnd = null;
    if (addToPlanning){
      planningStart = document.getElementById("agenda-planning-start").value;
      planningEnd = document.getElementById("agenda-planning-end").value;
      if (!planningStart || !planningEnd){
        showToast("Renseignez un début et une fin de créneau pour l'ajouter à la Journée type.", "error");
        return;
      }
      // Un créneau d'agenda ne peut être posé directement sur la Journée type
      // que s'il dure 1h ou moins — au-delà, ça relève de la structure de la
      // journée type elle-même, qu'il faut éditer via son propre panneau.
      const slotRanges = blockRanges(planningStart, planningEnd);
      const slotMinutes = slotRanges.reduce((sum,[s,e])=>sum+(e-s), 0);
      if (slotMinutes > 60){
        showToast("Un créneau de plus d'1h ne peut pas être ajouté directement à la Journée type : ouvrez le panneau « Journée type » dans Check-liste pour créer ou modifier ce bloc.", "error");
        return;
      }
      // Le chevauchement entre créneaux est volontairement autorisé (ex :
      // lire pendant un trajet) : pas de vérification ici.
    }

    const draft = {
      start_date: startDate, end_date: endDate, label,
      objective_id: objectiveId, planned_hours: hours,
      is_priority: isPriority, planning_start: planningStart, planning_end: planningEnd,
    };

    if (SUPABASE_CONFIGURED){
      try { state.agendaTasks.push(await db.insertAgendaTask(state.userId, draft)); }
      catch(err){ showToast("Erreur lors de l'ajout : " + err.message, "error"); return; }
    } else {
      state.agendaTasks.push({ id: nextId(), ...draft });
    }

    // Réinitialisation du formulaire
    document.getElementById("agenda-label").value = "";
    document.getElementById("agenda-hours").value = "1";
    document.getElementById("agenda-minutes").value = "0";
    document.getElementById("agenda-priority").checked = false;
    document.getElementById("agenda-add-to-planning").checked = false;
    document.getElementById("agenda-planning-slot").style.display = "none";
    document.getElementById("agenda-planning-start").value = "";
    document.getElementById("agenda-planning-end").value = "";
    renderAll();
  });

  async function deleteAgendaTask(id){
    if (SUPABASE_CONFIGURED){
      try { await db.deleteAgendaTask(id); }
      catch(err){ showToast("Erreur lors de la suppression : " + err.message, "error"); return; }
    }
    state.agendaTasks = state.agendaTasks.filter(t=>t.id!==id);
    renderAll();
  }

  function renderAgenda(){
    const objSelect = document.getElementById("agenda-objective");
    const currentVal = objSelect.value;
    objSelect.innerHTML = '<option value="">Aucun</option>' +
      state.objectives.map(o=>`<option value="${o.id}">${escapeHtml(o.title)}</option>`).join("");
    objSelect.value = currentVal;

    if (!document.getElementById("agenda-start-date").value){
      document.getElementById("agenda-start-date").value = todayISO();
    }

    const list = document.getElementById("agenda-list");
    // Les prières sont gérées automatiquement (ville + bouton "Musulman" dans
    // Profil) et ne doivent jamais encombrer l'onglet Agenda — elles restent
    // visibles uniquement dans la Check-liste et le résumé du Profil.
    const visibleAgendaTasks = state.agendaTasks.filter(t=>!(t.label||"").startsWith(PRAYER_LABEL_PREFIX));
    if (visibleAgendaTasks.length === 0){
      list.innerHTML = emptyStateHtml("Aucune tâche pour l'instant. Ajoutez-en une ci-dessus.");
      return;
    }

    const byDate = {};
    visibleAgendaTasks.forEach(t=>{ (byDate[t.start_date] = byDate[t.start_date] || []).push(t); });
    const dates = Object.keys(byDate).sort();

    list.innerHTML = dates.map(date=>{
      const dateFmt = new Date(date+"T00:00:00").toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
      const items = byDate[date].map(t=>{
        const cat = t.objective_id ? categoryOfObjective(t.objective_id) : "Agenda";
        const isPrayer = (t.label||"").startsWith(PRAYER_LABEL_PREFIX);
        const rangeText = t.end_date && t.end_date !== t.start_date ? ` → ${formatDateFr(t.end_date)}` : "";
        const slotText = t.planning_start && t.planning_end ? ` · ${t.planning_start}–${t.planning_end}` : "";
        // Pour une prière, l'heure est mise juste devant le nom : "🕌 Fajr : 06:30".
        const displayLabel = (isPrayer && t.planning_start) ? `${t.label} : ${t.planning_start}` : t.label;
        const metaText = isPrayer ? rangeText : `${t.planned_hours}h${rangeText}${slotText}`;
        return `
          <div class="agenda-item">
            <div>
              <span class="cat-badge" style="background:${categoryColor(cat)};">${escapeHtml(cat)}</span>${t.is_priority ? '<span class="priority-badge">Prioritaire</span>' : ""}
              <div style="margin-top:4px;">${escapeHtml(displayLabel)}</div>
              <div class="agenda-meta">${metaText}</div>
            </div>
            <button class="del-btn" data-agenda-id="${t.id}" title="Supprimer">Suppr.</button>
          </div>
        `;
      }).join("");
      return `<div class="agenda-group"><h4>${dateFmt}</h4>${items}</div>`;
    }).join("");

    list.querySelectorAll("[data-agenda-id]").forEach(btn=>{
      btn.addEventListener("click", ()=>deleteAgendaTask(btn.dataset.agendaId));
    });
  }

  let onboardingFocusDone = false;

  function renderPlanning(){
    const onboardingBox = document.getElementById("onboarding-callout");
    if (state.objectives.length === 0){
      onboardingBox.innerHTML = `
        <div class="onboarding-card">
          <h3>Bienvenue sur JamsPlans</h3>
          <p>Créez votre premier objectif ci-dessous pour démarrer. Vous pourrez ensuite lui associer des routines dans "Planning".</p>
        </div>
      `;
      if (!onboardingFocusDone){
        onboardingFocusDone = true;
        setTimeout(()=> document.getElementById("obj-title")?.focus(), 50);
      }
    } else {
      onboardingBox.innerHTML = "";
    }

    const list = document.getElementById("objective-list");
    list.innerHTML = "";
    const today = todayISO();
    const visibleObjectives = state.objectives.filter(objectiveMatchesSelectedYear);
    if (visibleObjectives.length === 0){
      list.innerHTML = `<li class="empty-state" style="border:1px dashed var(--line); background:none;">${emptyStateIcon()}Aucun objectif pour ${state.selectedAppYear === "all" ? "l'instant" : "l'année " + state.selectedAppYear}. Ajoutez-en un ci-dessus.</li>`;
    } else {
      visibleObjectives.forEach(obj=>{
        const li = document.createElement("li");
        li.style.flexDirection = "column";
        li.style.alignItems = "stretch";
        li.style.gap = "6px";

        const historyHtml = (obj.history && obj.history.length > 0)
          ? `<div class="objective-history">Reporté : ${obj.history.map(h=>`${h.fromYear} → ${h.toYear}`).join(" · ")}</div>`
          : "";

        const isOngoing = !obj.target_date && !obj.achieved;
        const dateRangeText = isOngoing ? "Tous les jours" : formatDateRangeFr(obj.start_date, obj.target_date);
        // Tant que l'échéance n'est pas dépassée (ou qu'il n'y en a pas), un
        // objectif non atteint n'est ni un succès ni un échec pour le ratio
        // de l'Archive (voir renderArchive) — ce badge le rend explicite ici
        // aussi, dans la liste des objectifs en cours.
        const isStillOpen = !obj.achieved && (!obj.target_date || obj.target_date >= today);

        const progressHtml = obj.is_monthly ? "" : objectiveProgressHtml(obj);

        li.innerHTML = `
          <div style="display:flex; align-items:flex-start; justify-content:space-between; width:100%;">
            <div style="flex:1;">
              <div class="obj-title">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span>${obj.is_monthly ? '<span class="cat-badge" style="background:var(--violet-soft); color:var(--violet);">mensuel</span>' : ""}${isOngoing ? '<span class="cat-badge" style="background:var(--violet-soft); color:var(--violet);">tous les jours</span>' : ""}${obj.achieved ? '<span class="achieved-badge">atteint</span>' : ""}</div>
              <div class="obj-meta">${obj.is_monthly ? "Objectif mensuel (coché le dernier jour du mois)" : `${obj.weekly_hours_target}h / semaine`}${dateRangeText ? " · "+dateRangeText : ""}</div>
              ${progressHtml}
              ${historyHtml}
            </div>
            <button class="del-btn" title="Supprimer">Suppr.</button>
          </div>
          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <button class="achieve-toggle">${obj.achieved ? "Marquer non atteint" : "Marquer atteint"}</button>
            ${isStillOpen ? '<button class="continue-btn give-up-btn">Pas encore réussi</button>' : ""}
            <button class="continue-btn edit-obj-btn">Modifier</button>
            ${isOngoing ? '<button class="continue-btn stop-objective-btn">Arrêter</button>' : ""}
            ${!obj.achieved && !isOngoing ? '<button class="continue-btn continue-year-btn">Poursuivre</button>' : ""}
          </div>
        `;
        li.querySelector(".del-btn").addEventListener("click", ()=>deleteObjective(obj.id));
        li.querySelector(".edit-obj-btn").addEventListener("click", ()=>startEditingObjective(obj));
        const stopBtn = li.querySelector(".stop-objective-btn");
        if (stopBtn){
          stopBtn.addEventListener("click", async ()=>{
            await stopOngoingObjective(obj.id);
            openContinueObjectivePrompt(obj, "arrêté");
          });
        }
        const giveUpBtn = li.querySelector(".give-up-btn");
        if (giveUpBtn){
          giveUpBtn.addEventListener("click", async ()=>{
            if (SUPABASE_CONFIGURED){
              try { const updated = await db.updateObjective(obj.id, { given_up: true }); Object.assign(obj, updated); }
              catch(err){ showToast("Erreur : " + err.message, "error"); return; }
            } else {
              obj.given_up = true;
            }
            renderAll();
            openContinueObjectivePrompt(obj, "en échec");
          });
        }
        li.querySelector(".achieve-toggle").addEventListener("click", async ()=>{
          const nextAchieved = !obj.achieved;
          const patch = nextAchieved ? { achieved: true, given_up: false } : { achieved: false };
          if (SUPABASE_CONFIGURED){
            try { const updated = await db.updateObjective(obj.id, patch); Object.assign(obj, updated); }
            catch(err){ showToast("Erreur : " + err.message, "error"); return; }
          } else {
            Object.assign(obj, patch);
          }
          renderAll();
          if (nextAchieved) openContinueObjectivePrompt(obj, "atteint");
        });
        const continueBtn = li.querySelector(".continue-year-btn");
        if (continueBtn){
          continueBtn.addEventListener("click", ()=>openContinueObjectiveForm(obj));
        }
        list.appendChild(li);
      });
    }

    // Pills de sélection d'objectif — uniquement les objectifs en cours
    // (poursuivis), les "réussis" ont leur propre écran.
    const pillsWrap = document.getElementById("obj-pills");
    pillsWrap.innerHTML = "";
    const pursuedObjectives = state.objectives.filter(o=>!o.achieved && objectiveMatchesSelectedYear(o));

    const selectedIsAchieved = state.objectives.find(o=>o.id===state.selectedPlanningObjective)?.achieved;
    if (selectedIsAchieved || !pursuedObjectives.some(o=>o.id===state.selectedPlanningObjective)){
      state.selectedPlanningObjective = pursuedObjectives[0]?.id || null;
    }

    if (pursuedObjectives.length === 0){
      pillsWrap.innerHTML = '<p class="muted" style="font-size:13px;">Aucun objectif en cours pour l\'instant.</p>';
    }
    pursuedObjectives.forEach(obj=>{
      const pill = document.createElement("button");
      pill.className = "pill" + (state.selectedPlanningObjective === obj.id ? " active" : "");
      pill.textContent = obj.title;
      pill.addEventListener("click", ()=>{ state.selectedPlanningObjective = obj.id; renderPlanning(); });
      pillsWrap.appendChild(pill);
    });

    renderObjectiveAlerts(pursuedObjectives);
    renderRoutineSection();
    renderArchive();
    renderGantt();
  }

  // Deux objectifs "se chevauchent" si leurs fenêtres [start_date, target_date]
  // ont une intersection non vide (les deux dates doivent être renseignées
  // des deux côtés pour pouvoir comparer).
  function findOverlappingObjectivePairs(objectives){
    const pairs = [];
    for (let i=0; i<objectives.length; i++){
      for (let j=i+1; j<objectives.length; j++){
        const a = objectives[i], b = objectives[j];
        if (!a.start_date || !a.target_date || !b.start_date || !b.target_date) continue;
        if (a.start_date <= b.target_date && b.start_date <= a.target_date){
          pairs.push([a, b]);
        }
      }
    }
    return pairs;
  }

  // Bannières d'alerte retirées à la demande de l'utilisateur (dispersion
  // des objectifs + chevauchement de dates) : la zone reste vide.
  function renderObjectiveAlerts(pursuedObjectives){
    const wrap = document.getElementById("objective-alerts");
    if (!wrap) return;
    wrap.innerHTML = "";
  }

  // =========================================================
  // GANTT : tous les objectifs de l'année sélectionnée, étalés sur une
  // frise annuelle, avec leur % de progression temporelle superposé.
  // =========================================================
  function renderGantt(){
    const wrap = document.getElementById("gantt-chart");
    if (!wrap) return;
    const year = state.selectedAppYear === "all" ? new Date().getFullYear() : parseInt(state.selectedAppYear);
    const yearStart = new Date(year, 0, 1).getTime();
    const yearEnd = new Date(year + 1, 0, 1).getTime();
    const yearSpan = yearEnd - yearStart;

    const objectives = state.objectives.filter(o=>{
      if (!o.start_date) return false;
      const s = new Date(o.start_date+"T00:00:00").getTime();
      // Un objectif "Tous les jours" (sans date de fin) reste visible tant
      // qu'il a commencé avant la fin de l'année affichée — il n'a pas
      // d'échéance à comparer.
      if (!o.target_date) return s < yearEnd;
      const e = new Date(o.target_date+"T00:00:00").getTime();
      return e >= yearStart && s < yearEnd;
    });

    if (objectives.length === 0){
      wrap.innerHTML = emptyStateHtml(`Aucun objectif avec des dates couvrant ${year}.`);
      return;
    }

    const monthLabelsHtml = MONTH_NAMES_SHORT.map(m=>`<span>${m}</span>`).join("");

    // Palette vive dédiée au Gantt (indépendante des couleurs de catégorie,
    // plus sobres) : chaque objectif prend une couleur différente pour que
    // la frise soit lisible et vivante d'un coup d'œil.
    const GANTT_VIVID_PALETTE = ["#FF7A18", "#22C55E", "#FFC400", "#FF3D9A"];

    const rowsHtml = objectives.map((obj, i)=>{
      const isOngoing = !obj.target_date;
      const s = Math.max(new Date(obj.start_date+"T00:00:00").getTime(), yearStart);
      const e = isOngoing ? yearEnd : Math.min(new Date(obj.target_date+"T00:00:00").getTime(), yearEnd);
      const leftPct = ((s - yearStart) / yearSpan) * 100;
      const widthPct = Math.max(((e - s) / yearSpan) * 100, 1);
      // Un objectif permanent n'a pas de "temps écoulé" à mesurer (pas
      // d'échéance) : on affiche plutôt son % de discipline (jours réussis).
      const time = objectiveTimeProgress(obj);
      const pct = isOngoing ? objectiveDisciplinePct(obj) : (time ? time.pct : 0);
      const pctLabel = isOngoing ? `${pct}% ∞` : `${pct}%`;
      const barColor = GANTT_VIVID_PALETTE[i % GANTT_VIVID_PALETTE.length];
      return `
        <div class="gantt-row">
          <div class="gantt-row-label">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span></div>
          <div class="gantt-track">
            <div class="gantt-bar" style="left:${leftPct}%; width:${widthPct}%; background:${barColor}80; box-shadow:0 0 0 1px ${barColor}, 0 0 8px ${barColor}99;" title="${isOngoing ? "Tous les jours : sans date de fin" : ""}">
              <div class="gantt-bar-fill" style="width:${pct}%; background:${barColor};"></div>
              <span class="gantt-bar-pct" style="color:#fff; font-weight:700; text-shadow:0 1px 3px rgba(0,0,0,.85);">${pctLabel}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `
      <div class="gantt-chart-inner">
        <div class="gantt-months">${monthLabelsHtml}</div>
        ${rowsHtml}
      </div>
    `;
  }

  const MONTH_NAMES_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

  function renderArchive(){
    const today = todayISO();
    const successes = state.objectives.filter(o=>o.achieved && objectiveMatchesSelectedYear(o));
    const failures = state.objectives.filter(o=>!o.achieved && (o.given_up || (o.target_date && o.target_date < today)) && objectiveMatchesSelectedYear(o));

    // Jauge du taux de réussite
    const total = successes.length + failures.length;
    const rate = total > 0 ? Math.round((successes.length/total)*100) : 0;
    const circumference = 2 * Math.PI * 58;
    const arc = document.getElementById("archive-gauge-arc");
    arc.setAttribute("stroke-dasharray", `${circumference}`);
    arc.setAttribute("stroke-dashoffset", `${circumference * (1 - rate/100)}`);
    document.getElementById("archive-gauge-pct").textContent = `${rate}%`;

    const successList = document.getElementById("archive-success-list");
    if (successes.length === 0){
      successList.innerHTML = `<li class="empty-state" style="border:1px dashed var(--line); background:none;">${emptyStateIcon()}Rien ici pour l'instant.</li>`;
    } else {
      successList.innerHTML = "";
      successes.forEach(obj=>{
        const li = document.createElement("li");
        li.style.flexDirection = "column";
        li.style.alignItems = "stretch";
        li.style.gap = "6px";
        const dateRangeText = formatDateRangeFr(obj.start_date, obj.target_date);
        li.innerHTML = `
          <div>
            <div class="obj-title">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span><span class="achieved-badge">atteint</span></div>
            <div class="obj-meta">${obj.is_monthly ? "Objectif mensuel" : `${obj.weekly_hours_target}h / semaine`}${dateRangeText ? " · "+dateRangeText : ""}</div>
            ${obj.is_monthly ? "" : objectiveProgressHtml(obj)}
          </div>
          <div style="display:flex; gap:12px;">
            <button class="achieve-toggle">Marquer non atteint</button>
            <button class="continue-btn edit-obj-btn">Modifier</button>
          </div>
        `;
        li.querySelector(".achieve-toggle").addEventListener("click", async ()=>{
          if (SUPABASE_CONFIGURED){
            try { const updated = await db.updateObjective(obj.id, { achieved: false }); Object.assign(obj, updated); }
            catch(err){ showToast("Erreur : " + err.message, "error"); return; }
          } else {
            obj.achieved = false;
          }
          renderAll();
        });
        li.querySelector(".edit-obj-btn").addEventListener("click", ()=>startEditingObjective(obj));
        successList.appendChild(li);
      });
    }

    const failureList = document.getElementById("archive-failure-list");
    if (failures.length === 0){
      failureList.innerHTML = `<li class="empty-state" style="border:1px dashed var(--line); background:none;">${emptyStateIcon()}Rien ici pour l'instant.</li>`;
    } else {
      failureList.innerHTML = "";
      failures.forEach(obj=>{
        const li = document.createElement("li");
        li.style.flexDirection = "column";
        li.style.alignItems = "stretch";
        li.style.gap = "6px";
        li.innerHTML = `
          <div>
            <div class="obj-title">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span><span class="priority-badge" style="color:var(--red); border-color:var(--red);">échec</span></div>
            <div class="obj-meta">${obj.is_monthly ? "Objectif mensuel" : `${obj.weekly_hours_target}h / semaine`} · ${obj.target_date && obj.target_date < today ? `échéance dépassée (${formatDateFr(obj.target_date)})` : "marqué en échec"}</div>
            ${obj.is_monthly ? "" : objectiveProgressHtml(obj)}
          </div>
          <div style="display:flex; gap:12px;">
            <button class="achieve-toggle">Marquer atteint</button>
            <button class="continue-btn edit-obj-btn">Modifier</button>
            <button class="continue-btn continue-year-btn">Poursuivre</button>
          </div>
        `;
        li.querySelector(".achieve-toggle").addEventListener("click", async ()=>{
          if (SUPABASE_CONFIGURED){
            try { const updated = await db.updateObjective(obj.id, { achieved: true, given_up: false }); Object.assign(obj, updated); }
            catch(err){ showToast("Erreur : " + err.message, "error"); return; }
          } else {
            obj.achieved = true;
            obj.given_up = false;
          }
          renderAll();
          openContinueObjectivePrompt(obj, "atteint");
        });
        li.querySelector(".edit-obj-btn").addEventListener("click", ()=>startEditingObjective(obj));
        li.querySelector(".continue-year-btn").addEventListener("click", ()=>openContinueObjectiveForm(obj));
        failureList.appendChild(li);
      });
    }
  }

  function renderRoutineSection(){
    const wrap = document.getElementById("routine-section");
    wrap.innerHTML = "";
    const objId = state.selectedPlanningObjective;

    if (state.objectives.length === 0){
      wrap.innerHTML = '<p class="muted" style="font-size:14px;">Créez d\'abord un objectif pour pouvoir y rattacher des créneaux.</p>';
      return;
    }
    if (!objId){
      wrap.innerHTML = '<p class="muted" style="font-size:14px;">Sélectionnez un objectif ci-dessus.</p>';
      return;
    }

    const form = document.createElement("form");
    form.className = "card obj-form";
    form.innerHTML = `
      <div style="min-width:220px;">
        <label class="field-label">Jours</label>
        <div id="routine-days" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        <button type="button" id="routine-days-all" class="del-btn" style="margin-top:4px; text-decoration:underline;">Toute la semaine</button>
      </div>
      <div style="flex:1; min-width:140px;">
        <label class="field-label" for="routine-label">Tâche</label>
        <input id="routine-label" placeholder="Ex : Comptabilité" />
      </div>
      <div>
        <label class="field-label" for="routine-hours">Durée</label>
        <div class="hours-input">
          <input id="routine-hours" type="number" min="0" step="1" value="2" /><span class="muted" style="font-size:12px;">h</span>
          <input id="routine-minutes" type="number" min="0" max="59" step="5" value="0" /><span class="muted" style="font-size:12px;">min</span>
        </div>
      </div>
      <div>
        <label class="field-label" for="routine-start-time">Début</label>
        <input id="routine-start-time" type="time" />
      </div>
      <div>
        <label class="field-label" for="routine-end-time">Fin</label>
        <input id="routine-end-time" type="time" />
      </div>
      <label style="display:flex; flex-direction:row; align-items:center; gap:5px; font-size:12px; color:var(--muted); white-space:nowrap;">
        <input type="checkbox" id="routine-priority" style="width:auto;" /> Prioritaire
      </label>
      <button type="submit" class="btn" style="align-self:flex-end;">+ Ajouter</button>
    `;
    const daysWrap = form.querySelector("#routine-days");
    DAYS.forEach(d=>{
      const dayLabel = document.createElement("label");
      dayLabel.style.cssText = "display:flex; flex-direction:row; align-items:center; gap:4px; font-size:12px; color:var(--muted); white-space:nowrap;";
      dayLabel.innerHTML = `<input type="checkbox" class="routine-day-checkbox" value="${d.value}" style="width:auto;" /> ${d.short}`;
      daysWrap.appendChild(dayLabel);
    });
    form.querySelector("#routine-days-all").addEventListener("click", ()=>{
      const boxes = form.querySelectorAll(".routine-day-checkbox");
      const allChecked = Array.from(boxes).every(b=>b.checked);
      boxes.forEach(b=>{ b.checked = !allChecked; });
    });
    form.addEventListener("submit", async e=>{
      e.preventDefault();
      const label = form.querySelector("#routine-label").value.trim();
      if (!label) return;
      const selectedDays = Array.from(form.querySelectorAll(".routine-day-checkbox:checked")).map(b=>parseInt(b.value));
      if (selectedDays.length === 0){
        showToast("Cochez au moins un jour de la semaine.", "error");
        return;
      }
      const plannedHours = hmToHours(form.querySelector("#routine-hours").value, form.querySelector("#routine-minutes").value);
      const baseDraft = {
        objective_id: objId,
        label,
        planned_hours: plannedHours,
        is_priority: form.querySelector("#routine-priority").checked,
        start_time: form.querySelector("#routine-start-time").value || null,
        end_time: form.querySelector("#routine-end-time").value || null,
      };
      // Un enregistrement crée une routine par jour coché — pratique pour
      // poser en une fois une tâche récurrente sur plusieurs jours (ou "Toute
      // la semaine" pour un objectif "tous les jours").
      for (const dayValue of selectedDays){
        const draft = { ...baseDraft, day_of_week: dayValue };
        if (SUPABASE_CONFIGURED){
          try { state.routines.push(await db.insertRoutine(state.userId, draft)); }
          catch(err){ showToast("Erreur lors de l'ajout du créneau : " + err.message, "error"); return; }
        } else {
          state.routines.push({ id: nextId(), ...draft });
        }
      }
      renderAll();
    });
    wrap.appendChild(form);

    const grid = document.createElement("div");
    grid.className = "day-grid";

    DAYS.forEach(d=>{
      const dayRoutines = state.routines.filter(r=>r.objective_id===objId && r.day_of_week===d.value);
      if (dayRoutines.length === 0) return;
      const block = document.createElement("div");
      block.className = "day-block";
      block.innerHTML = `<div class="day-name">${d.label}</div><ul></ul>`;
      const ul = block.querySelector("ul");
      dayRoutines.forEach(r=>{
        const li = document.createElement("li");
        const timeText = r.start_time && r.end_time ? ` · ${r.start_time.slice(0,5)}–${r.end_time.slice(0,5)}` : "";
        li.innerHTML = `<span>${escapeHtml(r.label)} <span class="muted">· ${r.planned_hours}h${timeText}</span>${r.is_priority ? '<span class="priority-badge">Prioritaire</span>' : ""}</span>`;
        const actions = document.createElement("span");
        actions.style.display = "flex";
        actions.style.gap = "10px";
        actions.style.alignItems = "center";

        const toggle = document.createElement("button");
        toggle.className = "achieve-toggle";
        toggle.style.marginTop = "0";
        toggle.textContent = r.is_priority ? "Retirer priorité" : "Marquer prioritaire";
        toggle.addEventListener("click", async ()=>{
          const nextPriority = !r.is_priority;
          if (SUPABASE_CONFIGURED){
            try {
              const { data, error } = await supabaseClient.from("routines").update({ is_priority: nextPriority }).eq("id", r.id).select().single();
              if (error) throw error;
              r.is_priority = data.is_priority;
            } catch(err){ showToast("Erreur : " + err.message, "error"); return; }
          } else {
            r.is_priority = nextPriority;
          }
          renderAll();
        });
        actions.appendChild(toggle);

        const del = document.createElement("button");
        del.className = "del-btn"; del.textContent = "Suppr.";
        del.addEventListener("click", async ()=>{
          if (SUPABASE_CONFIGURED){
            try { await db.deleteRoutine(r.id); }
            catch(err){ showToast("Erreur lors de la suppression : " + err.message, "error"); return; }
          }
          state.routines = state.routines.filter(x=>x.id!==r.id);
          renderAll();
        });
        actions.appendChild(del);
        li.appendChild(actions);
        ul.appendChild(li);
      });
      grid.appendChild(block);
    });
    wrap.appendChild(grid);
  }

  // =========================================================
  // ONGLET 2 : DAILY CHECK-IN
  // =========================================================
  // =========================================================
  // JOURNÉE TYPE : time-blocking de la journée (sommeil, trajet, travail...)
  // =========================================================
  function timeToMinutes(t){
    const [h,m] = t.split(":").map(Number);
    return h*60 + m;
  }

  // Durée en minutes d'un bloc (gère le passage de minuit).
  function blockDurationMin(start, end){
    const s = timeToMinutes(start), e = timeToMinutes(end);
    return e > s ? (e - s) : (1440 - s + e);
  }
  // Total des créneaux "structurants" (non superposés) d'une journée type,
  // hors un bloc éventuellement exclu (ex : celui en cours de modification) —
  // sert à vérifier qu'on ne dépasse jamais 24H au total.
  function templateTotalMinutesExcluding(tpl, excludeId){
    return tpl.blocks.filter(b=>!b.secondary && b.id!==excludeId).reduce((sum,b)=>sum + blockDurationMin(b.start, b.end), 0);
  }

  // Durée d'un bloc de journée type, affichée devant son libellé dans la
  // légende (ex : "8h Sommeil", "1h30 Trajet") — gère le passage de minuit.
  function formatBlockDuration(start, end){
    const startMin = timeToMinutes(start);
    const endMin = timeToMinutes(end);
    const durMin = endMin > startMin ? (endMin - startMin) : (1440 - startMin + endMin);
    const h = Math.floor(durMin/60);
    const m = durMin % 60;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2,"0")}`;
  }

  // Convertit un bloc (éventuellement à cheval sur minuit) en une ou deux
  // plages [début,fin[ en minutes, pour pouvoir tester un chevauchement.
  function blockRanges(start, end){
    const s = timeToMinutes(start), e = timeToMinutes(end);
    return e > s ? [[s, e]] : [[s, 1440], [0, e]]; // chevauche minuit -> 2 segments
  }

  function rangesOverlap(a, b){
    return a[0] < b[1] && b[0] < a[1];
  }

  // Un nouveau bloc "journée type" ne doit jamais chevaucher un bloc déjà
  // posé sur la même journée — ce sont des créneaux structurants (sommeil,
  // travail, trajet...), on ne peut pas être à deux endroits à la fois.
  // Les petites tâches ponctuelles (Agenda) n'ont pas d'horaire et ne sont
  // donc jamais concernées par cette règle.
  function findOverlappingBlock(start, end, excludeId, blocks){
    const newRanges = blockRanges(start, end);
    const activeTpl = getActiveTemplate();
    for (const block of (blocks || (activeTpl ? activeTpl.blocks : []))){
      if (block.id === excludeId) continue;
      const existingRanges = blockRanges(block.start, block.end);
      for (const r1 of newRanges){
        for (const r2 of existingRanges){
          if (rangesOverlap(r1, r2)) return block;
        }
      }
    }
    return null;
  }

  // Bloc en cours de modification via le formulaire (boutons "Modifier" de la
  // légende) — null quand le formulaire sert à ajouter un nouveau bloc.
  let editingDayTemplateBlockId = null;

  // Période en cours de modification via le formulaire "+ Nouvelle période"
  // (bouton "✎" affiché sur chaque pastille) — null quand le formulaire sert
  // à créer une nouvelle période.
  let editingPeriodId = null;

  // Le bouton "Par défaut" (période sans dates) a été retiré de
  // l'interface : plus aucune sélection automatique de repli. Si aucune
  // période datée ne correspond, il n'y a simplement pas de journée type
  // active (l'utilisateur est invité à en créer une).
  function getActiveTemplate(){
    return state.dayTemplates.find(t=>t.id===state.activeDayTemplateId) || null;
  }

  // Compare uniquement jour+mois (ignore l'année), pour les périodes qui se
  // répètent chaque année — gère aussi les plages qui traversent le 31
  // décembre (ex : 01 oct -> 31 mars).
  function isDateInAnnualRange(dateStr, startStr, endStr){
    const md = dateStr.slice(5);
    const startMd = startStr.slice(5);
    const endMd = endStr.slice(5);
    if (startMd <= endMd) return md >= startMd && md <= endMd;
    return md >= startMd || md <= endMd;
  }

  // Retrouve la journée type applicable à une date donnée : celle dont la
  // période (début->fin) couvre cette date, ET dont la liste de jours de la
  // semaine (si renseignée) inclut le jour de cette date. Une période sans
  // jours cochés s'applique à tous les jours de sa plage de dates. Ça permet
  // par exemple une journée type "Semaine" (Lun-Ven) et une autre "Week-end"
  // (Sam-Dim) actives sur la même plage de dates. Une période marquée
  // "se répète chaque année" (recurring_yearly) n'est comparée que sur le
  // jour+mois, pour n'avoir à la saisir qu'une seule fois.
  function getTemplateForDate(dateStr){
    const dow = new Date(dateStr+"T00:00:00").getDay();
    return state.dayTemplates.find(t=>{
      if (!t.period_start || !t.period_end) return false;
      const inRange = t.recurring_yearly
        ? isDateInAnnualRange(dateStr, t.period_start, t.period_end)
        : (dateStr >= t.period_start && dateStr <= t.period_end);
      if (!inRange) return false;
      return !Array.isArray(t.weekdays) || t.weekdays.length === 0 || t.weekdays.includes(dow);
    }) || null;
  }

  // Anneau 24h : chaque bloc devient un segment coloré positionné par angle.
  // L'anneau se remplit visuellement à mesure que des heures sont bloquées ;
  // les trous restés couleur neutre = temps non planifié. Purement visuel :
  // pour modifier ou supprimer un bloc, on passe par les boutons de la légende.
  // Prières du jour, superposées à TOUTES les journées type (quelle que soit
  // la période affichée) dès que "Musulman" est coché dans Profil — lecture
  // seule ici (pas de Modifier/Supprimer, pas comptées dans les heures
  // bloquées) : elles vivent dans Profil/Check-liste, pas dans les blocs
  // enregistrés de la journée type.
  function getTodaysPrayerPseudoBlocks(){
    if (!state.prayerEnabled) return [];
    const today = todayISO();
    return state.agendaTasks
      .filter(t=>t.start_date===today && (t.label||"").startsWith(PRAYER_LABEL_PREFIX) && t.planning_start && t.planning_end)
      .map(t=>({ id: "prayer-"+t.id, start: t.planning_start, end: t.planning_end, label: t.label }));
  }

  function blocksToRingSegments(list){
    const segs = [];
    list.forEach(block=>{
      const startMin = timeToMinutes(block.start);
      const endMin = timeToMinutes(block.end);
      if (endMin > startMin){
        segs.push({ block, startMin, lenMin: endMin - startMin });
      } else {
        // Le bloc chevauche minuit (ex: 23:00 -> 08:00) -> deux segments
        segs.push({ block, startMin, lenMin: 1440 - startMin });
        segs.push({ block, startMin: 0, lenMin: endMin });
      }
    });
    return segs;
  }

  function renderDayTemplateRing(){
    const wrap = document.getElementById("day-template-ring");
    const size = 260, cx = 130, cy = 130, r = 88, sw = 20;
    const C = 2 * Math.PI * r;
    const activeTpl = getActiveTemplate();
    const blocks = activeTpl ? activeTpl.blocks : [];
    // Les blocs "secondaires" (case "Chevauche un autre créneau" cochée, ex :
    // lecture pendant un trajet) occupent un temps déjà compté par le
    // créneau qu'ils chevauchent : ils sont retirés de l'anneau principal et
    // du total, et affichés séparément sur leur propre anneau ci-dessous.
    const primaryBlocks = blocks.filter(b=>!b.secondary);
    const secondaryBlocks = blocks.filter(b=>b.secondary);
    const prayerBlocks = getTodaysPrayerPseudoBlocks();

    const segments = blocksToRingSegments(primaryBlocks);
    const secondarySegments = blocksToRingSegments(secondaryBlocks);
    const prayerSegments = blocksToRingSegments(prayerBlocks);
    const blockColorMap = buildDayBlockColorMap(blocks);

    const totalBlockedMin = segments.reduce((s,seg)=>s+seg.lenMin, 0);
    const totalHours = Math.round((totalBlockedMin/60)*10)/10;

    const segmentsHtml = segments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*C;
      const dashoffset = C*(1-startFrac);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${blockColorMap[seg.block.label] || categoryColor(seg.block.label)}" stroke-width="${sw}"
        stroke-dasharray="${arcLen} ${C-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})" class="dt-ring-seg" data-block-id="${seg.block.id}">
        <title>${escapeHtml(seg.block.label)} (${seg.block.start} à ${seg.block.end})</title>
      </circle>`;
    }).join("");

    // Anneau intermédiaire, dédié aux activités secondaires : superposition
    // purement visuelle sur son propre anneau, jamais mélangée aux créneaux
    // structurants ni comptée dans le total "bloquées / 24h" ci-dessous.
    const rSecondary = r - sw/2 - 8, swSecondary = 10;
    const CSecondary = 2 * Math.PI * rSecondary;
    const secondaryRingBase = secondaryBlocks.length
      ? `<circle cx="${cx}" cy="${cy}" r="${rSecondary}" fill="none" stroke="var(--empty)" stroke-width="${swSecondary}" />`
      : "";
    const secondarySegmentsHtml = secondarySegments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*CSecondary;
      const dashoffset = CSecondary*(1-startFrac);
      return `<circle cx="${cx}" cy="${cy}" r="${rSecondary}" fill="none" stroke="${blockColorMap[seg.block.label] || categoryColor(seg.block.label)}" stroke-width="${swSecondary}"
        stroke-dasharray="${arcLen} ${CSecondary-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})" class="dt-ring-seg-secondary" data-block-id="${seg.block.id}">
        <title>${escapeHtml(seg.block.label)} (${formatBlockDuration(seg.block.start, seg.block.end)}, ${seg.block.start} à ${seg.block.end}) — superposé, non compté dans le total</title>
      </circle>`;
    }).join("");

    // Anneau intérieur fin, dédié aux prières : superposition purement
    // visuelle, jamais mélangée aux blocs réels de la journée type.
    const rPrayer = rSecondary - swSecondary/2 - 6 - 4, swPrayer = 8;
    const CPrayer = 2 * Math.PI * rPrayer;
    const prayerRingBase = prayerBlocks.length
      ? `<circle cx="${cx}" cy="${cy}" r="${rPrayer}" fill="none" stroke="var(--empty)" stroke-width="${swPrayer}" />`
      : "";
    const prayerSegmentsHtml = prayerSegments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*CPrayer;
      const dashoffset = CPrayer*(1-startFrac);
      return `<circle cx="${cx}" cy="${cy}" r="${rPrayer}" fill="none" stroke="var(--violet)" stroke-width="${swPrayer}"
        stroke-dasharray="${arcLen} ${CPrayer-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})" class="dt-ring-seg-prayer">
        <title>${escapeHtml(seg.block.label)} (${seg.block.start})</title>
      </circle>`;
    }).join("");

    const ticks = [
      { angle: -90, label: "0h" },
      { angle: 0, label: "6h" },
      { angle: 90, label: "12h" },
      { angle: 180, label: "18h" },
    ];
    const tickR = r + sw/2 + 16;
    const ticksHtml = ticks.map(t=>{
      const rad = t.angle * Math.PI/180;
      const x = cx + tickR*Math.cos(rad);
      const y = cy + tickR*Math.sin(rad);
      return `<text x="${x}" y="${y}" text-anchor="middle" dy="0.35em" font-size="10" font-family="'IBM Plex Mono',monospace" fill="var(--muted)">${t.label}</text>`;
    }).join("");

    wrap.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--empty)" stroke-width="${sw}" />
        ${segmentsHtml}
        ${secondaryRingBase}
        ${secondarySegmentsHtml}
        ${prayerRingBase}
        ${prayerSegmentsHtml}
        ${ticksHtml}
        <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="20" font-family="'IBM Plex Mono',monospace" fill="var(--ink)">${totalHours}h</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="10" fill="var(--muted)">bloquées / 24h</text>
      </svg>
    `;
  }

  // Barre de progression linéaire "Xh sur 24h utilisées", mise à jour à
  // chaque ajout / modification / suppression d'un élément de journée type.
  function renderDayTemplateProgress(){
    const wrap = document.getElementById("day-template-progress");
    if (!wrap) return;
    const activeTpl = getActiveTemplate();
    const blocks = activeTpl ? activeTpl.blocks.filter(b=>!b.secondary) : [];
    const totalMin = blocks.reduce((sum,b)=>{
      const s = timeToMinutes(b.start), e = timeToMinutes(b.end);
      return sum + (e > s ? (e - s) : (1440 - s + e));
    }, 0);
    const totalHours = Math.round((totalMin/60)*10)/10;
    const pct = Math.min((totalMin/1440)*100, 100);
    wrap.innerHTML = `
      <div class="checkin-summary-bar-label"><span>Heures planifiées</span><span>${totalHours}h sur 24h</span></div>
      <div class="checkin-summary-track"><div class="checkin-summary-fill" style="width:${pct}%; background:linear-gradient(90deg,#4C8FD6,#4CAF6D);"></div></div>
    `;
  }

  // Légende : un repère par plage horaire, pour savoir exactement ce qui
  // est prévu à chaque instant sans avoir à survoler l'anneau.
  function renderDayTemplateLegend(){
    const legend = document.getElementById("day-template-legend");
    const activeTpl = getActiveTemplate();
    const prayerBlocks = [...getTodaysPrayerPseudoBlocks()].sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));
    const blocks = activeTpl ? [...activeTpl.blocks].sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start)) : [];
    if (blocks.length === 0 && prayerBlocks.length === 0){
      legend.innerHTML = activeTpl
        ? '<p class="muted" style="font-size:13px;">Aucune plage définie pour cette période.</p>'
        : '<p class="muted" style="font-size:13px;">Aucune période sélectionnée. Créez-en une avec « + Nouvelle période ».</p>';
      return;
    }
    const blockColorMap = buildDayBlockColorMap(blocks);
    // Un bloc "secondaire" (coché "Chevauche un autre créneau" dans la fiche,
    // ex : lecture pendant un trajet) est affiché en retrait, avec un petit
    // repère juste avant son horaire, pour bien le distinguer des créneaux
    // structurants qui se suivent — sans rien changer d'autre pour eux.
    const blocksHtml = blocks.map(b=>{
      const linkedObjectives = getBlockLinkedObjectives(b);
      const linkedObjectivesText = linkedObjectives.map(o=>o.title).join(" + ");
      return `
      <div class="dt-legend-item${b.secondary ? " dt-legend-secondary" : ""}" data-block-id="${b.id}">
        <span class="dt-swatch" style="background:${blockColorMap[b.label] || categoryColor(b.label)};"></span>
        <span><span class="mono" style="font-weight:600;">${formatBlockDuration(b.start, b.end)}</span> ${escapeHtml(b.label)}${linkedObjectivesText ? ` <span class="muted" style="font-size:10.5px;">· ${escapeHtml(linkedObjectivesText)}</span>` : ""}</span>
        ${b.secondary ? '<span class="dt-secondary-badge" title="Chevauche un autre créneau">⤷ superposé</span>' : ""}
        <span class="mono muted">${b.start}–${b.end}</span>
        <span style="display:flex; gap:8px; margin-left:auto;">
          <button type="button" class="achieve-toggle dt-edit-btn" style="margin-top:0;">Modifier</button>
          <button type="button" class="del-btn dt-delete-btn">Supprimer</button>
        </span>
      </div>
    `;
    }).join("");
    // Prières du jour : lecture seule, pas de Modifier/Supprimer (elles se
    // gèrent depuis Profil), affichées avec la couleur de l'anneau intérieur.
    const prayerHtml = prayerBlocks.map(b=>`
      <div class="dt-legend-item">
        <span class="dt-swatch" style="background:var(--violet);"></span>
        <span>${escapeHtml(b.label)}</span>
        <span class="mono muted">${b.start}</span>
      </div>
    `).join("");
    legend.innerHTML = blocksHtml + prayerHtml;

    legend.querySelectorAll(".dt-edit-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.closest("[data-block-id]").dataset.blockId;
        const activeTpl = getActiveTemplate();
        const block = activeTpl && activeTpl.blocks.find(b=>b.id===id);
        if (!block) return;
        editingDayTemplateBlockId = id;
        document.getElementById("dt-start").value = block.start;
        document.getElementById("dt-end").value = block.end;
        document.getElementById("dt-label").value = block.label;
        document.getElementById("dt-secondary").checked = !!block.secondary;
        setDtObjectiveIds(getBlockObjectiveIds(block));
        document.getElementById("dt-submit-btn").textContent = "Enregistrer les modifications";
        document.getElementById("dt-cancel-edit-btn").style.display = "inline-block";
        document.getElementById("dt-label").focus();
      });
    });
    legend.querySelectorAll(".dt-delete-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.closest("[data-block-id]").dataset.blockId;
        if (editingDayTemplateBlockId === id) cancelDayTemplateEdit();
        deleteDayTemplateBlock(id);
      });
    });
  }

  function cancelDayTemplateEdit(){
    editingDayTemplateBlockId = null;
    document.getElementById("dt-start").value = "09:00";
    document.getElementById("dt-end").value = "10:00";
    document.getElementById("dt-label").value = "";
    document.getElementById("dt-secondary").checked = false;
    setDtObjectiveIds([]);
    document.getElementById("dt-submit-btn").textContent = "+ Ajouter";
    document.getElementById("dt-cancel-edit-btn").style.display = "none";
  }

  document.getElementById("dt-cancel-edit-btn").addEventListener("click", cancelDayTemplateEdit);

  // Pills de sélection de période + formulaire de création d'une nouvelle
  // journée type bornée à une plage de dates. Le bouton "Par défaut" (sans
  // dates) a été retiré : seules les périodes datées sont listées ici — une
  // ancienne période "Par défaut" éventuellement présente dans les données
  // reste intacte en base mais n'apparaît plus (et n'est plus sélectionnable
  // depuis cette liste).
  // Réinitialise le formulaire "+ Nouvelle période" et sort du mode édition
  // (bouton "✎" d'une pastille) — sans toucher à son affichage (ouvert/fermé),
  // laissé aux appelants.
  function cancelPeriodEdit(){
    editingPeriodId = null;
    document.getElementById("np-name").value = "";
    document.getElementById("np-start").value = "";
    document.getElementById("np-end").value = "";
    document.querySelectorAll("#np-weekdays input[type=checkbox]").forEach(cb=>{ cb.checked = false; });
    document.getElementById("np-recurring").checked = false;
    document.getElementById("np-submit-btn").textContent = "Créer la période";
    document.getElementById("np-cancel-edit-btn").style.display = "none";
  }

  document.getElementById("np-cancel-edit-btn").addEventListener("click", ()=>{
    cancelPeriodEdit();
    document.getElementById("new-period-form").style.display = "none";
    document.getElementById("new-period-btn").classList.remove("active");
  });

  function renderDayTemplatePeriods(){
    const wrap = document.getElementById("day-template-periods");
    const datedTemplates = state.dayTemplates.filter(t=>t.period_start && t.period_end);
    wrap.innerHTML = datedTemplates.map(t=>{
      const rangeText = t.recurring_yearly
        ? `${formatAnnualRangeFr(t.period_start, t.period_end)}, chaque année`
        : formatDateRangeFr(t.period_start, t.period_end);
      const weekdaysText = formatWeekdaysFr(t.weekdays);
      const detailText = weekdaysText ? `${rangeText} · ${weekdaysText}` : rangeText;
      const active = t.id === state.activeDayTemplateId ? " active" : "";
      return `<div class="dt-period-item">
        <button type="button" class="pill${active}" data-tpl-id="${t.id}">${escapeHtml(t.name)} <span class="muted" style="font-size:10.5px;">(${detailText})</span></button>
        <button type="button" class="dt-period-edit-btn" data-tpl-id="${t.id}" title="Modifier cette période">✎</button>
        <button type="button" class="dt-period-duplicate-btn" data-tpl-id="${t.id}" title="Dupliquer cette période">⧉</button>
        <button type="button" class="dt-period-delete-btn" data-tpl-id="${t.id}" title="Supprimer cette période">✕</button>
      </div>`;
    }).join("") + `<button type="button" id="new-period-btn" class="pill pill-new">+ Nouvelle période</button>`;

    wrap.querySelectorAll(".pill[data-tpl-id]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        state.activeDayTemplateId = btn.dataset.tplId;
        renderDayTemplate();
      });
    });
    // Bouton "✎" : ouvre le formulaire pré-rempli avec les infos de cette
    // période, et bascule son envoi en mode "modification" (editingPeriodId).
    wrap.querySelectorAll(".dt-period-edit-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const tpl = state.dayTemplates.find(t=>t.id===btn.dataset.tplId);
        if (!tpl) return;
        editingPeriodId = tpl.id;
        document.getElementById("np-name").value = tpl.name || "";
        document.getElementById("np-start").value = tpl.period_start || "";
        document.getElementById("np-end").value = tpl.period_end || "";
        const checkedDays = Array.isArray(tpl.weekdays) ? tpl.weekdays : [];
        document.querySelectorAll("#np-weekdays input[type=checkbox]").forEach(cb=>{
          cb.checked = checkedDays.includes(parseInt(cb.value, 10));
        });
        document.getElementById("np-recurring").checked = !!tpl.recurring_yearly;
        document.getElementById("np-submit-btn").textContent = "Enregistrer les modifications";
        document.getElementById("np-cancel-edit-btn").style.display = "inline-block";
        document.getElementById("new-period-form").style.display = "flex";
        document.getElementById("new-period-btn").classList.add("active");
        document.getElementById("np-name").focus();
      });
    });
    // Bouton "⧉" : duplique la période (nom + "(copie)", nouvel id, et
    // chaque bloc reçoit aussi un nouvel id pour ne jamais entrer en
    // collision avec l'original). Pratique pour une nouvelle saison : on
    // duplique l'ancienne période, on la renomme et on ajuste juste ce qui
    // change, au lieu de tout ressaisir. La copie s'ouvre directement en
    // mode modification pour renommer/ajuster les dates tout de suite.
    wrap.querySelectorAll(".dt-period-duplicate-btn").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const tpl = state.dayTemplates.find(t=>t.id===btn.dataset.tplId);
        if (!tpl) return;
        const copy = {
          ...tpl,
          id: nextId(),
          name: `${tpl.name} (copie)`,
          weekdays: Array.isArray(tpl.weekdays) ? [...tpl.weekdays] : [],
          blocks: (tpl.blocks || []).map(b=>({ ...b, id: nextId(), objective_ids: Array.isArray(b.objective_ids) ? [...b.objective_ids] : [] })),
        };
        state.dayTemplates.push(copy);
        state.activeDayTemplateId = copy.id;
        await saveDayTemplates();
        renderDayTemplate();
        // Ouvre directement le formulaire de période en mode modification,
        // pré-rempli avec la copie, pour renommer et ajuster les dates.
        document.querySelector(`.dt-period-edit-btn[data-tpl-id="${copy.id}"]`)?.click();
      });
    });
    // Bouton "✕" : supprime définitivement la période (et ses plages
    // horaires associées). Suppression immédiate, comme pour les autres
    // éléments de l'app (blocs, objectifs, tâches d'agenda…).
    wrap.querySelectorAll(".dt-period-delete-btn").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id = btn.dataset.tplId;
        if (editingPeriodId === id){
          cancelPeriodEdit();
          document.getElementById("new-period-form").style.display = "none";
        }
        state.dayTemplates = state.dayTemplates.filter(t=>t.id!==id);
        if (state.activeDayTemplateId === id){
          const remaining = state.dayTemplates.filter(t=>t.period_start && t.period_end);
          state.activeDayTemplateId = remaining[0] ? remaining[0].id : null;
        }
        await saveDayTemplates();
        renderDayTemplate();
      });
    });
    // Retour visuel manquant auparavant : le bouton "+ Nouvelle période"
    // reste maintenant coloré (actif) tant que son formulaire est ouvert.
    const newPeriodBtn = document.getElementById("new-period-btn");
    const formOpen = document.getElementById("new-period-form").style.display !== "none"
      && document.getElementById("new-period-form").style.display !== "";
    newPeriodBtn.classList.toggle("active", formOpen);
    newPeriodBtn.addEventListener("click", ()=>{
      const panel = document.getElementById("new-period-form");
      const isOpen = panel.style.display !== "none" && panel.style.display !== "";
      if (isOpen){
        panel.style.display = "none";
        if (editingPeriodId) cancelPeriodEdit();
        newPeriodBtn.classList.remove("active");
      } else {
        panel.style.display = "flex";
        newPeriodBtn.classList.add("active");
      }
    });
  }

  // Cases à cocher "Objectif correspondant" de la fiche d'ajout d'un
  // élément de journée type : relie chaque créneau (Sport, Travail...) à
  // un ou plusieurs objectifs qu'il sert (plusieurs cases peuvent être
  // cochées à la fois), ou à aucun quand il ne sert aucun objectif en
  // particulier (ex : Sommeil, Trajet). Repeuplée à chaque affichage pour
  // rester à jour avec la liste des objectifs, en conservant les cases déjà
  // cochées. Deux objectifs peuvent porter le même titre (ex : une "suite"
  // créée via "Poursuivre") : l'année cible est ajoutée entre parenthèses
  // pour les distinguer.
  function getDtObjectiveIds(){
    const wrap = document.getElementById("dt-objective-list");
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll("input:checked")).map(cb=>cb.value);
  }
  function setDtObjectiveIds(ids){
    const wrap = document.getElementById("dt-objective-list");
    if (!wrap) return;
    wrap.querySelectorAll("input").forEach(cb=>{ cb.checked = ids.includes(cb.value); });
  }
  function populateDtObjectiveSelect(){
    const wrap = document.getElementById("dt-objective-list");
    if (!wrap) return;
    const currentIds = getDtObjectiveIds();
    wrap.innerHTML = state.objectives.map(o=>`
      <label class="np-day-chip" style="white-space:normal;">
        <input type="checkbox" value="${o.id}" />
        ${escapeHtml(o.title)}${o.currentYear ? ` <span class="muted" style="font-size:9.5px;">· ${o.currentYear}</span>` : ""}
      </label>
    `).join("");
    setDtObjectiveIds(currentIds);
  }

  function renderDayTemplate(){
    populateDtObjectiveSelect();
    renderDayTemplatePeriods();
    renderDayTemplateRing();
    renderDayTemplateProgress();
    renderDayTemplateLegend();
  }

  async function saveDayTemplates(){
    if (SUPABASE_CONFIGURED){
      try { await db.upsertProfile(state.userId, { day_template: state.dayTemplates }); }
      catch(err){ showToast("Erreur lors de l'enregistrement de la journée type : " + err.message, "error"); }
    }
  }

  // Les périodes et leurs blocs (créneaux) sont gérés entièrement côté
  // client (pas d'id généré par la base) : un ancien bug de génération d'id
  // (remis à zéro à chaque rechargement de page) a pu faire qu'un bloc ou
  // une période créé(e) lors d'une session porte le même id qu'un autre créé
  // lors d'une session précédente. Résultat : cliquer "Modifier" sur l'un
  // modifiait l'autre (celui trouvé en premier dans le tableau), ce qui
  // semblait "au hasard". On corrige ça au chargement en réattribuant un
  // nouvel id (unique) à tout doublon détecté, puis on sauvegarde si besoin.
  function dedupeDayTemplateIds(){
    let changed = false;
    const seenTplIds = new Set();
    state.dayTemplates.forEach(tpl=>{
      if (seenTplIds.has(tpl.id)){ tpl.id = nextId(); changed = true; }
      seenTplIds.add(tpl.id);
      const seenBlockIds = new Set();
      (tpl.blocks || []).forEach(b=>{
        if (seenBlockIds.has(b.id)){ b.id = nextId(); changed = true; }
        seenBlockIds.add(b.id);
      });
    });
    return changed;
  }

  async function deleteDayTemplateBlock(id){
    const activeTpl = getActiveTemplate();
    if (!activeTpl) return;
    activeTpl.blocks = activeTpl.blocks.filter(b=>b.id!==id);
    await saveDayTemplates();
    renderDayTemplate();
  }

  // Trois vues mutuellement exclusives dans l'onglet du soir : Journée type,
  // Check-liste (résumé + liste, la vue par défaut) et Consulter un jour.
  // Un seul bouton "actif" (rempli) à la fois, les deux autres en "secondary"
  // (contour) — c'est ce retour visuel qui manquait auparavant.
  function syncTodayViewsVisibility(){
    const templateOpen = document.getElementById("day-template-panel").style.display === "block";
    const consultOpen = document.getElementById("day-consult-panel").style.display === "block";
    const checkinOpen = !templateOpen && !consultOpen;
    document.getElementById("checkin-summary").style.display = checkinOpen ? "block" : "none";
    document.getElementById("checkin-list").style.display = checkinOpen ? "block" : "none";

    const setActive = (id, active)=>{
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle("secondary", !active);
    };
    setActive("day-template-toggle", templateOpen);
    setActive("checkin-view-toggle", checkinOpen);
    setActive("day-consult-toggle", consultOpen);
  }

  document.getElementById("day-template-toggle").addEventListener("click", ()=>{
    document.getElementById("day-template-panel").style.display = "block";
    document.getElementById("day-consult-panel").style.display = "none";
    renderDayTemplate();
    syncTodayViewsVisibility();
  });

  document.getElementById("checkin-view-toggle").addEventListener("click", ()=>{
    document.getElementById("day-template-panel").style.display = "none";
    document.getElementById("day-consult-panel").style.display = "none";
    syncTodayViewsVisibility();
  });

  document.getElementById("new-period-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const name = document.getElementById("np-name").value.trim() || "Nouvelle période";
    const start = document.getElementById("np-start").value || null;
    const end = document.getElementById("np-end").value || null;
    if (!start || !end){
      showToast("Renseignez une date de début et de fin pour la période.", "error");
      return;
    }
    const weekdays = Array.from(document.querySelectorAll("#np-weekdays input[type=checkbox]:checked")).map(cb=>parseInt(cb.value, 10));
    const recurringYearly = document.getElementById("np-recurring").checked;
    if (editingPeriodId){
      const tpl = state.dayTemplates.find(t=>t.id===editingPeriodId);
      if (tpl){
        tpl.name = name;
        tpl.period_start = start;
        tpl.period_end = end;
        tpl.weekdays = weekdays;
        tpl.recurring_yearly = recurringYearly;
      }
    } else {
      const tpl = { id: nextId(), name, period_start: start, period_end: end, weekdays, recurring_yearly: recurringYearly, blocks: [] };
      state.dayTemplates.push(tpl);
      state.activeDayTemplateId = tpl.id;
    }
    await saveDayTemplates();
    cancelPeriodEdit();
    document.getElementById("new-period-form").style.display = "none";
    document.getElementById("new-period-btn").classList.remove("active");
    renderDayTemplate();
  });

  document.getElementById("day-template-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const activeTpl = getActiveTemplate();
    if (!activeTpl){
      showToast("Sélectionnez ou créez d'abord une période avec « + Nouvelle période ».", "error");
      return;
    }
    const start = document.getElementById("dt-start").value;
    const end = document.getElementById("dt-end").value;
    const label = document.getElementById("dt-label").value.trim();
    const secondary = document.getElementById("dt-secondary").checked;
    const objectiveIds = getDtObjectiveIds();
    if (!start || !end || !label) return;

    // Le chevauchement entre créneaux est volontairement autorisé (ex : lire
    // pendant un trajet) : pas de vérification de chevauchement ici. En
    // revanche, le total des créneaux structurants (non superposés) d'une
    // journée type ne doit jamais dépasser 24H.
    if (!secondary){
      const excludeId = editingDayTemplateBlockId || null;
      const existingMin = templateTotalMinutesExcluding(activeTpl, excludeId);
      const newMin = blockDurationMin(start, end);
      if (existingMin + newMin > 1440){
        showToast("24H atteint : impossible d'ajouter ce créneau, la journée type dépasserait 24 heures.", "error");
        return;
      }
    }

    if (editingDayTemplateBlockId){
      const block = activeTpl.blocks.find(b=>b.id===editingDayTemplateBlockId);
      if (block){ block.start = start; block.end = end; block.label = label; block.secondary = secondary; block.objective_ids = objectiveIds; delete block.objective_id; }
      cancelDayTemplateEdit();
    } else {
      activeTpl.blocks.push({ id: nextId(), start, end, label, secondary, objective_ids: objectiveIds });
      // Auto-chaînage : la fin du bloc qu'on vient d'ajouter devient le début
      // proposé pour le prochain, et la fin est initialisée à la même heure
      // (plutôt que vide) pour ne pas ressaisir l'heure à chaque fois et que
      // le champ ne "bouge" plus tant qu'on ne l'a pas changée soi-même.
      document.getElementById("dt-start").value = end;
      document.getElementById("dt-end").value = end;
      document.getElementById("dt-label").value = "";
      document.getElementById("dt-secondary").checked = false;
      setDtObjectiveIds([]);
    }
    await saveDayTemplates();
    renderDayTemplate();
  });

  // =========================================================
  // CONSULTER UN JOUR : croise journée type + agenda + routines + check-ins
  // réels pour une date choisie, afin de voir ce qui s'est passé à chaque
  // moment de la journée.
  // =========================================================
  function statusLabel(status){
    if (status === "done") return "Fait";
    if (status === "partial") return "Partiel";
    if (status === "not_done") return "Non fait";
    return "Pas encore";
  }

  function renderDayConsult(dateStr){
    const result = document.getElementById("day-consult-result");
    const dow = new Date(dateStr+"T00:00:00").getDay();
    const template = getTemplateForDate(dateStr);

    const items = [];

    // Blocs de la journée type applicable à cette date (aucun check-in
    // associé : ce sont des repères de structure, pas des tâches cochées).
    // Aucune période datée ne couvre forcément cette date (le bouton "Par
    // défaut" a été retiré) : dans ce cas, simplement pas de bloc structure.
    if (template){
      template.blocks.forEach(b=>{
        items.push({ start: b.start, end: b.end, label: b.label, kind: "template", status: null, secondary: !!b.secondary, blockObjectiveIds: getBlockObjectiveIds(b) });
      });
    }

    // Routines avec horaire, dont le jour de semaine correspond et dont
    // l'objectif est actif à cette date.
    state.routines.filter(r=>r.day_of_week === dow && r.start_time && r.end_time).forEach(r=>{
      const obj = state.objectives.find(o=>o.id===r.objective_id);
      if (obj){
        if (obj.start_date && dateStr < obj.start_date) return;
        if (obj.target_date && dateStr > obj.target_date) return;
      }
      const log = state.dailyLogs.find(l=>l.routine_id===r.id && l.log_date===dateStr);
      items.push({ start: r.start_time.slice(0,5), end: r.end_time.slice(0,5), label: r.label, kind: "routine", status: log ? log.status : null, hours: log ? log.actual_hours : null, planned: r.planned_hours, objective_id: r.objective_id || null });
    });

    // Tâches d'agenda avec créneau, dont la plage de dates couvre ce jour.
    state.agendaTasks.filter(t=> dateStr >= t.start_date && dateStr <= t.end_date && t.planning_start && t.planning_end).forEach(t=>{
      const log = state.dailyLogs.find(l=>l.agenda_task_id===t.id && l.log_date===dateStr);
      const isPrayer = (t.label||"").startsWith(PRAYER_LABEL_PREFIX);
      items.push({ start: t.planning_start.slice(0,5), end: t.planning_end.slice(0,5), label: t.label, kind: "agenda", status: log ? log.status : null, hours: log ? log.actual_hours : null, planned: t.planned_hours, isPrayer, objective_id: t.objective_id || null });
    });

    // Tâches sans horaire précis (agenda libre) : listées à part, en bas.
    const untimed = state.agendaTasks.filter(t=> dateStr >= t.start_date && dateStr <= t.end_date && !(t.planning_start && t.planning_end));

    // Fusion des doublons : un bloc de journée type et une routine/tâche
    // d'agenda qui occupent exactement le même horaire (ex : bloc "lire"
    // 08:10-08:40 + routine "Lire 30P" 08:10-08:40 liée à l'objectif "Lire
    // 30 pages/j") représentent la même chose réelle — plutôt que deux
    // lignes séparées, une seule ligne montre l'élément de journée type,
    // l'objectif concerné à côté, et le détail réel du jour (statut/heures)
    // à la place du simple tag "structure".
    const templateItems = items.filter(it=>it.kind === "template");
    const otherItems = items.filter(it=>it.kind !== "template");
    const usedOther = new Set();
    const displayItems = templateItems.map(tpl=>{
      const matchIdx = otherItems.findIndex((o,i)=>!usedOther.has(i) && o.start === tpl.start && o.end === tpl.end);
      const objIds = new Set(tpl.blockObjectiveIds || []);
      let match = null;
      if (matchIdx !== -1){
        usedOther.add(matchIdx);
        match = otherItems[matchIdx];
        if (match.objective_id) objIds.add(match.objective_id);
      }
      const objectiveTitles = Array.from(objIds).map(id=>state.objectives.find(o=>o.id===id)).filter(Boolean).map(o=>o.title);
      return {
        start: tpl.start, end: tpl.end, secondary: tpl.secondary, isStructural: true,
        label: tpl.label,
        matchedLabel: match && match.label !== tpl.label ? match.label : null,
        objectiveTitles,
        hasRealTracking: !!match,
        status: match ? match.status : null,
        hours: match ? match.hours : null,
        planned: match ? match.planned : null,
        isPrayer: match ? match.isPrayer : false,
      };
    }).concat(
      otherItems.filter((o,i)=>!usedOther.has(i)).map(o=>({ ...o, isStructural: false, secondary: false, objectiveTitles: [], hasRealTracking: true }))
    );

    displayItems.sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));

    const rowsHtml = displayItems.map(it=>{
      const statusKey = it.status || "none";
      const swatchColor = it.isStructural ? categoryColor(it.label) : "var(--violet)";
      const showStatus = !it.isStructural || it.hasRealTracking;
      const hoursText = showStatus && it.hours !== null && it.hours !== undefined ? ` · ${it.hours}h/${it.planned}h` : "";
      const labelSuffix = it.matchedLabel ? ` · ${escapeHtml(it.matchedLabel)}` : "";
      const objectiveTag = it.objectiveTitles && it.objectiveTitles.length
        ? ` <span class="muted" style="font-size:10.5px;">· ${escapeHtml(it.objectiveTitles.join(" + "))}</span>`
        : "";
      // Même repère "⤷ superposé" que dans la légende de "Journée type",
      // pour reconnaître d'un coup d'œil ce qui n'est pas compté dans les 24H.
      const secondaryBadge = it.secondary
        ? '<span class="dt-secondary-badge" title="Chevauche un autre créneau">⤷ superposé</span>'
        : "";
      return `
        <div class="dc-item">
          <span class="dc-swatch" style="background:${swatchColor};"></span>
          <span class="dc-time">${it.isPrayer ? it.start : `${it.start}–${it.end}`}</span>
          <span class="dc-label">${escapeHtml(it.label)}${labelSuffix}${hoursText}${objectiveTag}</span>
          ${secondaryBadge}
          ${showStatus ? `<span class="dc-status ${statusKey}">${statusLabel(it.status)}</span>` : `<span class="dc-status none">structure</span>`}
        </div>
      `;
    }).join("");

    const untimedHtml = untimed.length > 0 ? `
      <p class="label" style="margin-top:14px;">Tâches sans horaire ce jour-là</p>
      ${untimed.map(t=>{
        const log = state.dailyLogs.find(l=>l.agenda_task_id===t.id && l.log_date===dateStr);
        const statusKey = log ? log.status : "none";
        return `<div class="dc-item"><span class="dc-swatch" style="background:var(--violet);"></span><span class="dc-label">${escapeHtml(t.label)}</span><span class="dc-status ${statusKey}">${statusLabel(log ? log.status : null)}</span></div>`;
      }).join("")}
    ` : "";

    const ringHtml = renderDayConsultRing(displayItems, dateStr);

    result.innerHTML = `
      <p class="label">${template ? `Journée type appliquée : ${escapeHtml(template.name)}` : "Aucune journée type ne couvre cette date."}</p>
      ${ringHtml}
      ${rowsHtml || '<p class="muted" style="font-size:13px;">Rien de programmé à horaire fixe ce jour-là.</p>'}
      ${untimedHtml}
    `;
  }

  // Anneau miroir de celui de "Journée type" : les blocs de structure
  // apparaissent en fond (plus discret), et les routines/tâches d'agenda
  // se superposent, colorées par leur statut réel ce jour-là (vert/orange
  // /rouge) si un check-in existe, sinon par leur catégorie.
  // Même mise en forme que l'anneau de "Journée type" (renderDayTemplateRing) :
  // un anneau principal pour les éléments structurants de la journée (blocs
  // de journée type non superposés), un anneau secondaire juste en dessous
  // pour tout ce qui se superpose (blocs "Chevauche un autre créneau" +
  // routines/tâches d'agenda, qui ne font pas partie de la structure figée),
  // des couleurs vives (colorées par statut réel quand un check-in existe),
  // et les repères d'heure 0h/6h/12h/18h autour de l'anneau.
  function renderDayConsultRing(items, dateStr){
    if (items.length === 0) return "";
    const size = 260, cx = 130, cy = 130, r = 88, sw = 20;
    const C = 2 * Math.PI * r;

    const primaryItems = items.filter(it=>it.isStructural && !it.secondary);
    const secondaryItems = items.filter(it=>!(it.isStructural && !it.secondary));

    const toSegments = (list)=>{
      const segs = [];
      list.forEach(it=>{
        const startMin = timeToMinutes(it.start);
        const endMin = timeToMinutes(it.end);
        if (endMin > startMin){
          segs.push({ it, startMin, lenMin: endMin - startMin });
        } else {
          segs.push({ it, startMin, lenMin: 1440 - startMin });
          segs.push({ it, startMin: 0, lenMin: endMin });
        }
      });
      return segs;
    };

    const colorFor = (it)=>{
      if (it.status === "done") return "var(--green)";
      if (it.status === "partial") return "var(--orange)";
      if (it.status === "not_done") return "var(--red)";
      return categoryColor(it.label);
    };

    const segments = toSegments(primaryItems);
    // Même total que dans "Journée type" : les heures occupées par les
    // éléments structurants (hors superposés), sur 24h.
    const totalMin = segments.reduce((sum, seg)=>sum + seg.lenMin, 0);
    const totalHours = Math.round((totalMin/60)*10)/10;
    const segmentsHtml = segments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*C;
      const dashoffset = C*(1-startFrac);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colorFor(seg.it)}" stroke-width="${sw}"
        stroke-dasharray="${arcLen} ${C-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})">
        <title>${escapeHtml(seg.it.label)} (${seg.it.start} à ${seg.it.end})</title>
      </circle>`;
    }).join("");

    const rSecondary = r - sw/2 - 8, swSecondary = 10;
    const CSecondary = 2 * Math.PI * rSecondary;
    const secondarySegments = toSegments(secondaryItems);
    const secondaryRingBase = secondarySegments.length
      ? `<circle cx="${cx}" cy="${cy}" r="${rSecondary}" fill="none" stroke="var(--empty)" stroke-width="${swSecondary}" />`
      : "";
    const secondarySegmentsHtml = secondarySegments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*CSecondary;
      const dashoffset = CSecondary*(1-startFrac);
      return `<circle cx="${cx}" cy="${cy}" r="${rSecondary}" fill="none" stroke="${colorFor(seg.it)}" stroke-width="${swSecondary}"
        stroke-dasharray="${arcLen} ${CSecondary-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})">
        <title>${escapeHtml(seg.it.label)} (${seg.it.start} à ${seg.it.end})${seg.it.isStructural ? " — superposé" : ""}</title>
      </circle>`;
    }).join("");

    const ticks = [
      { angle: -90, label: "0h" },
      { angle: 0, label: "6h" },
      { angle: 90, label: "12h" },
      { angle: 180, label: "18h" },
    ];
    const tickR = r + sw/2 + 16;
    const ticksHtml = ticks.map(t=>{
      const rad = t.angle * Math.PI/180;
      const x = cx + tickR*Math.cos(rad);
      const y = cy + tickR*Math.sin(rad);
      return `<text x="${x}" y="${y}" text-anchor="middle" dy="0.35em" font-size="10" font-family="'IBM Plex Mono',monospace" fill="var(--muted)">${t.label}</text>`;
    }).join("");

    const dayLabel = new Date(dateStr+"T00:00:00").toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" });

    return `
      <div style="display:flex; justify-content:center; margin:12px 0;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--empty)" stroke-width="${sw}" />
          ${segmentsHtml}
          ${secondaryRingBase}
          ${secondarySegmentsHtml}
          ${ticksHtml}
          <text x="${cx}" y="${cy-24}" text-anchor="middle" font-size="12" font-family="'IBM Plex Mono',monospace" fill="var(--muted)">${dayLabel}</text>
          <text x="${cx}" y="${cy+2}" text-anchor="middle" font-size="20" font-family="'IBM Plex Mono',monospace" fill="var(--ink)">${totalHours}h</text>
          <text x="${cx}" y="${cy+22}" text-anchor="middle" font-size="10" fill="var(--muted)">occupées / 24h</text>
        </svg>
      </div>
    `;
  }

  document.getElementById("day-consult-toggle").addEventListener("click", ()=>{
    document.getElementById("day-consult-panel").style.display = "block";
    document.getElementById("day-template-panel").style.display = "none";
    const dateInput = document.getElementById("day-consult-date");
    if (!dateInput.value) dateInput.value = todayISO();
    renderDayConsult(dateInput.value);
    syncTodayViewsVisibility();
  });

  document.getElementById("day-consult-date").addEventListener("change", e=>{
    renderDayConsult(e.target.value || todayISO());
  });

  // Résumé du jour : tâches faites / heures réalisées, en un coup d'œil
  // avant même de scroller dans la liste détaillée.
  function renderCheckinSummary(items, date){
    const box = document.getElementById("checkin-summary");
    if (items.length === 0){
      box.innerHTML = "";
      box.style.display = "none";
      return;
    }
    box.style.display = "block";

    let doneCount = 0, totalPlanned = 0, totalActual = 0;
    items.forEach(item=>{
      const existing = state.dailyLogs.find(l=> l.log_date===date && (
        item.routine_id ? l.routine_id===item.routine_id : l.agenda_task_id===item.agenda_task_id
      ));
      totalPlanned += item.planned_hours;
      if (existing){
        totalActual += existing.actual_hours;
        if (existing.status !== "not_done" && existing.actual_hours > 0) doneCount += 1;
      }
    });

    const pctTasks = items.length > 0 ? Math.round((doneCount/items.length)*100) : 0;
    const pctHours = totalPlanned > 0 ? Math.min((totalActual/totalPlanned)*100, 100) : 0;

    box.innerHTML = `
      <div class="checkin-summary-row">
        <span class="label" style="margin:0;">Résumé du jour</span>
        <span class="big">${doneCount}<span class="sep">/${items.length} tâches</span></span>
      </div>
      <div class="checkin-summary-bars">
        <div>
          <div class="checkin-summary-bar-label"><span>Tâches faites</span><span>${doneCount}/${items.length}</span></div>
          <div class="checkin-summary-track"><div class="checkin-summary-fill" style="width:${pctTasks}%; background:linear-gradient(90deg,#4C8FD6,#4CAF6D);"></div></div>
        </div>
        <div>
          <div class="checkin-summary-bar-label"><span>Heures réalisées</span><span>${totalActual.toFixed(1)}h / ${totalPlanned.toFixed(1)}h</span></div>
          <div class="checkin-summary-track"><div class="checkin-summary-fill" style="width:${pctHours}%; background:linear-gradient(90deg,#A48CE8,#4CAF6D);"></div></div>
        </div>
      </div>
    `;
  }

  function renderCheckin(){
    renderDayTemplate();
    syncTodayViewsVisibility();
    // Toujours "aujourd'hui" — aucune autre date n'est sélectionnable ici.
    const date = todayISO();
    const dow = new Date(date+"T00:00:00").getDay();
    const dayLabel = DAYS.find(d=>d.value===dow)?.label || "";
    const dateFmt = new Date(date+"T00:00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"long" });
    document.getElementById("checkin-day-label").textContent =
      `Aujourd'hui, ${dayLabel} ${dateFmt}`;
    renderWeatherTip();

    // Tâches déjà enregistrées dans Target (routines) pour ce jour uniquement —
    // jamais demain, jamais un autre jour — et seulement si la fenêtre de
    // l'objectif parent (date de début -> date de fin) inclut aujourd'hui.
    const todaysRoutines = state.routines.filter(r=>{
      if (r.day_of_week !== dow) return false;
      const obj = state.objectives.find(o=>o.id===r.objective_id);
      if (!obj) return true;
      if (obj.start_date && date < obj.start_date) return false;
      if (obj.target_date && date > obj.target_date) return false;
      return true;
    }).map(r=>({
      key: "routine-"+r.id, label: r.label, planned_hours: r.planned_hours,
      objective_id: r.objective_id, routine_id: r.id, agenda_task_id: null,
      is_priority: r.is_priority,
    }));

    // Tâches saisies dans Agenda dont la plage (début -> fin) inclut
    // aujourd'hui — elles remontent automatiquement ici, sans double saisie.
    const todaysAgendaTasks = state.agendaTasks.filter(t=>{
      if (date < t.start_date || date > t.end_date) return false;
      const isPrayerTask = (t.label||"").startsWith(PRAYER_LABEL_PREFIX);
      if (isPrayerTask && !state.prayerEnabled) return false;
      return true;
    }).map(t=>({
      key: "agenda-"+t.id, label: t.label, planned_hours: t.planned_hours,
      objective_id: t.objective_id || null, routine_id: null, agenda_task_id: t.id,
      is_priority: t.is_priority, planning_start: t.planning_start || null,
    }));

    const items = [...todaysRoutines, ...todaysAgendaTasks];
    renderCheckinSummary(items, date);

    const list = document.getElementById("checkin-list");
    list.innerHTML = "";

    // Objectifs mensuels (case "Objectif mensuel" cochée dans Target, ex :
    // "Mettre 1000€ de côté") : à cocher une seule fois par mois — ils
    // n'apparaissent donc qu'ici, le tout dernier jour du mois, pour ne pas
    // encombrer la Check-liste le reste du temps.
    if (isLastDayOfMonth(date)){
      const monthKey = date.slice(0, 7); // "YYYY-MM"
      state.objectives.filter(o=>o.is_monthly && !o.achieved).forEach(obj=>{
        const done = !!(obj.monthly_completions && obj.monthly_completions[monthKey]);
        const card = document.createElement("div");
        card.className = "card";
        card.style.marginBottom = "12px";
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:14px;">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span><span class="pending-badge">mensuel</span></strong>
          </div>
          <label style="display:flex; align-items:center; gap:8px; margin-top:10px; cursor:pointer; font-size:13px;">
            <input type="checkbox" class="monthly-obj-checkbox" style="width:auto;" ${done ? "checked" : ""} />
            Fait ce mois-ci
          </label>
        `;
        card.querySelector(".monthly-obj-checkbox").addEventListener("change", async e=>{
          const checked = e.target.checked;
          const completions = { ...(obj.monthly_completions || {}), [monthKey]: checked };
          if (SUPABASE_CONFIGURED){
            try {
              const updated = await db.updateObjective(obj.id, { monthly_completions: completions });
              Object.assign(obj, updated);
            } catch(err){ showToast("Erreur : " + err.message, "error"); e.target.checked = !checked; return; }
          } else {
            obj.monthly_completions = completions;
          }
          showToast(checked ? "Marqué fait pour ce mois-ci." : "Décoché pour ce mois-ci.", "success");
        });
        list.appendChild(card);
      });
    }

    if (items.length === 0){
      if (list.innerHTML === ""){
        list.innerHTML = emptyStateHtml("Aucune tâche pour aujourd'hui. Ajoutez une routine dans « Target » ou une tâche dans « Agenda ».");
      }
      return;
    }

    items.forEach(item=>{
      const existing = state.dailyLogs.find(l=> l.log_date===date && (
        item.routine_id ? l.routine_id===item.routine_id : l.agenda_task_id===item.agenda_task_id
      ));
      const cat = item.objective_id ? categoryOfObjective(item.objective_id) : "Agenda";
      const isPrayer = (item.label||"").startsWith(PRAYER_LABEL_PREFIX);
      const prayerName = isPrayer ? item.label.slice(PRAYER_LABEL_PREFIX.length) : null;
      // Pour une prière, on affiche l'heure juste devant le nom : "🕌 Fajr : 06:30".
      const displayLabel = (isPrayer && item.planning_start) ? `${item.label} : ${item.planning_start}` : item.label;
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "12px";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:14px;">${isPrayer
            ? `<span class="prayer-name-open" style="cursor:pointer; text-decoration:underline dotted;" title="Voir le calendrier de cette prière">${escapeHtml(displayLabel)}</span>`
            : escapeHtml(displayLabel)}<span class="cat-badge" style="background:${categoryColor(cat)};">${escapeHtml(cat)}</span>${item.is_priority ? '<span class="priority-badge">Prioritaire</span>' : ""}</strong>
          ${isPrayer ? "" : `<span class="mono muted" style="font-size:12px;">${item.planned_hours}h prévues</span>`}
        </div>
        <div class="status-row">
          <button class="status-btn" data-status="done">${isPrayer ? "Fait à l'heure" : "Fait"}</button>
          <button class="status-btn" data-status="partial">${isPrayer ? "Fait" : "Partiel"}</button>
          <button class="status-btn" data-status="not_done">${isPrayer ? "Pas fait" : "Non fait"}</button>
        </div>
        <div style="margin-top:10px; display:flex; align-items:center; gap:8px; ${isPrayer ? "display:none;" : ""}">
          <label class="muted" style="font-size:12px;">Heures réalisées</label>
          <input type="number" min="0" step="0.25" class="actual-hours mono" style="width:80px;" value="${existing ? existing.actual_hours : item.planned_hours}" />
          <span class="muted" style="font-size:12px;">/ ${item.planned_hours}h</span>
        </div>
        <div class="excuse-block" style="margin-top:8px; ${isPrayer ? "display:none;" : ""}">
          <label class="muted" style="font-size:12px;">Exception</label>
          <select class="excuse-select" style="width:auto; margin-left:6px;">
            <option value="">Aucune (jour normal)</option>
            <option value="malade">Malade</option>
            <option value="conges_payes">Congés payés</option>
            <option value="autre">Autre</option>
          </select>
          <input type="text" class="excuse-other-input mono" placeholder="Précise la raison" style="display:none; margin-top:6px; width:100%;" />
        </div>
        <button class="btn savebtn">Enregistrer</button>
      `;
      if (isPrayer){
        const nameEl = card.querySelector(".prayer-name-open");
        if (nameEl) nameEl.addEventListener("click", ()=> openPrayerCalendar(prayerName));
      }
      const excuseBlock = card.querySelector(".excuse-block");
      const excuseSelect = card.querySelector(".excuse-select");
      const excuseOtherInput = card.querySelector(".excuse-other-input");
      const existingReason = existing && existing.excused_reason ? existing.excused_reason : "";
      if (existingReason === "malade" || existingReason === "conges_payes" || existingReason === ""){
        excuseSelect.value = existingReason;
      } else {
        // Raison personnalisée enregistrée précédemment ("Autre").
        excuseSelect.value = "autre";
        excuseOtherInput.value = existingReason;
        excuseOtherInput.style.display = "block";
      }
      excuseSelect.addEventListener("change", ()=>{
        excuseOtherInput.style.display = excuseSelect.value === "autre" ? "block" : "none";
      });
      let currentStatus = existing ? existing.status : "done";
      // L'exception (malade / congés payés / autre) n'a de sens que si la
      // tâche n'a pas été faite ou seulement partiellement — on la cache
      // sinon pour ne pas mélanger "fait" et "excusé".
      function updateExcuseVisibility(){
        // Pas de section "Exception" pour les prières, quel que soit le statut.
        excuseBlock.style.display = (!isPrayer && (currentStatus === "not_done" || currentStatus === "partial")) ? "block" : "none";
        if (excuseBlock.style.display === "none"){
          excuseSelect.value = "";
          excuseOtherInput.value = "";
          excuseOtherInput.style.display = "none";
        }
      }
      updateExcuseVisibility();
      card.querySelectorAll(".status-btn").forEach(b=>{
        if (b.dataset.status === currentStatus) b.classList.add("active");
        b.addEventListener("click", ()=>{
          card.querySelectorAll(".status-btn").forEach(x=>x.classList.remove("active"));
          b.classList.add("active");
          currentStatus = b.dataset.status;
          updateExcuseVisibility();
        });
      });
      const saveBtn = card.querySelector(".savebtn");
      saveBtn.addEventListener("click", async ()=>{
        const actual = parseFloat(card.querySelector(".actual-hours").value) || 0;
        const excuseValue = excuseSelect.value;
        const excusedReason = excuseValue === "" ? null
          : excuseValue === "autre" ? (excuseOtherInput.value.trim() || "Autre")
          : excuseValue;
        const idx = state.dailyLogs.findIndex(l=> l.log_date===date && (
          item.routine_id ? l.routine_id===item.routine_id : l.agenda_task_id===item.agenda_task_id
        ));
        const draft = {
          routine_id: item.routine_id,
          agenda_task_id: item.agenda_task_id,
          objective_id: item.objective_id,
          log_date: date,
          status: currentStatus,
          planned_hours: item.planned_hours,
          actual_hours: actual,
          excused_reason: excusedReason,
        };

        if (SUPABASE_CONFIGURED){
          try {
            const saved = await db.upsertDailyLog(state.userId, draft, existing ? existing.id : null);
            const savedIdx = state.dailyLogs.findIndex(l=>l.id===saved.id);
            if (savedIdx>=0) state.dailyLogs[savedIdx] = saved; else state.dailyLogs.push(saved);
          } catch(err){ showToast("Erreur lors de l'enregistrement : " + err.message, "error"); return; }
        } else {
          const entry = { id: idx>=0 ? state.dailyLogs[idx].id : nextId(), ...draft };
          if (idx>=0) state.dailyLogs[idx] = entry; else state.dailyLogs.push(entry);
        }

        saveBtn.textContent = "Enregistré";
        saveBtn.classList.add("saved");
        if (navigator.vibrate) navigator.vibrate(15);
        setTimeout(()=>{ saveBtn.textContent = "Enregistrer"; saveBtn.classList.remove("saved"); }, 1500);
        renderCheckinSummary(items, date);
        renderDashboard();
      });
      list.appendChild(card);
    });
  }

  // =========================================================
  // CALENDRIER PAR PRIÈRE (modal ouvert au clic sur le nom d'une prière
  // dans la Check-liste) — vert = priée à l'heure, bleu = priée (statut
  // "Fait" mais pas "à l'heure"), orange = pas faite. Tout l'historique est
  // déjà chargé en mémoire (state.agendaTasks / state.dailyLogs), donc pas
  // de nouvel appel réseau.
  // =========================================================
  const PRAYER_CAL_COLOR_HEX = { green: "var(--green)", blue: "var(--blue)", orange: "var(--orange)" };
  let prayerCalState = { name: null, year: new Date().getFullYear(), month: new Date().getMonth() };

  function prayerColorForDate(prayerName, dateStr){
    if (dateStr > todayISO()) return null; // jour futur : rien à afficher
    const task = state.agendaTasks.find(t=>t.start_date===dateStr && t.label===PRAYER_LABEL_PREFIX+prayerName);
    const log = task ? state.dailyLogs.find(l=>l.agenda_task_id===task.id) : null;
    if (log && log.status === "done") return "green";
    if (log && log.status === "partial") return "blue";
    return "orange"; // pas de tâche générée, pas de check-in, ou "Pas fait"
  }

  function renderPrayerCalendarGrid(){
    const { name, year, month } = prayerCalState;
    const title = document.getElementById("prayer-cal-title");
    if (title) title.textContent = name || "";
    const monthLabel = document.getElementById("prayer-cal-month-label");
    if (monthLabel) monthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;
    const weekdayHeader = document.getElementById("prayer-cal-weekday-header");
    if (weekdayHeader) weekdayHeader.innerHTML = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d=>`<span>${d}</span>`).join("");
    const grid = document.getElementById("prayer-cal-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lundi = début de semaine
    for (let i=0; i<leadingBlanks; i++){
      const blank = document.createElement("div");
      blank.className = "cal-cell blank";
      grid.appendChild(blank);
    }
    for (let day=1; day<=daysInMonth; day++){
      const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const color = prayerColorForDate(name, dateStr);
      const cell = document.createElement("div");
      cell.className = "cal-cell mono";
      cell.style.background = color ? PRAYER_CAL_COLOR_HEX[color] : "var(--empty)";
      cell.style.color = color ? "#fff" : "var(--muted)";
      cell.title = dateStr;
      cell.textContent = day;
      grid.appendChild(cell);
    }
  }

  function openPrayerCalendar(prayerName){
    const today = new Date();
    prayerCalState = { name: prayerName, year: today.getFullYear(), month: today.getMonth() };
    renderPrayerCalendarGrid();
    const overlay = document.getElementById("prayer-cal-overlay");
    if (overlay) overlay.style.display = "flex";
  }

  document.getElementById("prayer-cal-close")?.addEventListener("click", ()=>{
    document.getElementById("prayer-cal-overlay").style.display = "none";
  });
  document.getElementById("prayer-cal-overlay")?.addEventListener("click", (e)=>{
    if (e.target.id === "prayer-cal-overlay") e.currentTarget.style.display = "none";
  });
  document.getElementById("prayer-cal-prev")?.addEventListener("click", ()=>{
    prayerCalState.month -= 1;
    if (prayerCalState.month < 0){ prayerCalState.month = 11; prayerCalState.year -= 1; }
    renderPrayerCalendarGrid();
  });
  document.getElementById("prayer-cal-next")?.addEventListener("click", ()=>{
    prayerCalState.month += 1;
    if (prayerCalState.month > 11){ prayerCalState.month = 0; prayerCalState.year += 1; }
    renderPrayerCalendarGrid();
  });

  // =========================================================
  // ONGLET 3 : DASHBOARD
  // =========================================================
  document.querySelectorAll("#range-pills .pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#range-pills .pill").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      state.dashboardRange = btn.dataset.range;
      document.getElementById("month-year-selectors").classList.toggle("visible", state.dashboardRange === "monthCal");
      renderDashboard();
    });
  });

  const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  // Toutes les années "connues" par l'app : logs enregistrés, échéances
  // d'objectifs, historique de report N -> N+1, plus l'année en cours.
  function knownYears(){
    const years = new Set([new Date().getFullYear()]);
    state.dailyLogs.forEach(l=> years.add(new Date(l.log_date+"T00:00:00").getFullYear()));
    state.objectives.forEach(o=>{
      if (o.target_date) years.add(new Date(o.target_date+"T00:00:00").getFullYear());
      years.add(o.currentYear);
      o.history.forEach(h=>{ years.add(h.fromYear); years.add(h.toYear); });
    });
    return Array.from(years).sort((a,b)=>a-b);
  }

  function renderDashboard(){
    // Filtre objectif
    const select = document.getElementById("dash-objective-filter");
    select.innerHTML = '<option value="all">Tous les objectifs</option>';
    state.objectives.forEach(o=>{
      const opt = document.createElement("option");
      opt.value = o.id; opt.textContent = o.title;
      select.appendChild(opt);
    });
    select.value = state.selectedDashboardObjective;
    select.onchange = ()=>{ state.selectedDashboardObjective = select.value; renderDashboard(); };

    // Sélecteurs Année / Mois (visibles uniquement en vue "Mois")
    const yearSelect = document.getElementById("dash-year-select");
    const years = knownYears();
    yearSelect.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
    yearSelect.value = state.dashboardYear;
    yearSelect.onchange = ()=>{ state.dashboardYear = parseInt(yearSelect.value); renderDashboard(); };

    const monthSelect = document.getElementById("dash-month-select");
    monthSelect.innerHTML = MONTH_NAMES.map((m,i)=>`<option value="${i}">${m}</option>`).join("");
    monthSelect.value = state.dashboardMonth;
    monthSelect.onchange = ()=>{ state.dashboardMonth = parseInt(monthSelect.value); renderDashboard(); };

    // -------------------- Filtrage des logs selon la vue --------------------
    let filtered;
    let gaugeSubLabel;

    if (state.dashboardRange === "monthCal"){
      const y = state.dashboardYear, m = state.dashboardMonth;
      filtered = state.dailyLogs.filter(l=>{
        const d = new Date(l.log_date+"T00:00:00");
        const matchObj = state.selectedDashboardObjective==="all" || l.objective_id===state.selectedDashboardObjective;
        return matchObj && d.getFullYear()===y && d.getMonth()===m;
      });
      gaugeSubLabel = `Heures réalisées vs. heures attendues (${MONTH_NAMES[m]} ${y})`;
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (state.dashboardRange==="week" ? 7 : 30));
      filtered = state.dailyLogs.filter(l=>{
        const matchObj = state.selectedDashboardObjective==="all" || l.objective_id===state.selectedDashboardObjective;
        const matchRange = new Date(l.log_date+"T00:00:00") >= cutoff;
        return matchObj && matchRange;
      });
      gaugeSubLabel = `Heures réalisées vs. heures attendues (${state.dashboardRange==="week"?"semaine":"mois glissant"})`;
    }

    const streakLogs = state.dailyLogs.filter(l=> state.selectedDashboardObjective==="all" || l.objective_id===state.selectedDashboardObjective);

    const discipline = computeDiscipline(filtered);
    const performance = computePerformance(filtered);
    const { planned, actual, ratio } = computeHoursRatio(filtered);
    const streak = computeStreak(streakLogs);

    // KPI cards
    const kpiGrid = document.getElementById("kpi-grid");
    kpiGrid.innerHTML = `
      <div class="kpi-card"><div class="label">Discipline</div><div class="val green mono">${discipline.toFixed(1)}%</div></div>
      <div class="kpi-card"><div class="label">Performance</div><div class="val orange mono">${performance.toFixed(1)}%</div></div>
      <div class="kpi-card"><div class="label">Heures</div><div class="val mono">${actual.toFixed(1)}h / ${planned.toFixed(1)}h</div></div>
      <div class="kpi-card"><div class="label">Série en cours</div><div class="val mono">${streak} j</div></div>
    `;

    // Jauge (cercle SVG)
    document.getElementById("gauge-sub").textContent = gaugeSubLabel;
    const circumference = 2 * Math.PI * 76;
    const pct = Math.min(ratio, 1); // le tracé se limite à 100%, le chiffre affiché peut dépasser
    const arc = document.getElementById("gauge-arc");
    arc.setAttribute("stroke-dasharray", `${circumference}`);
    arc.setAttribute("stroke-dashoffset", `${circumference * (1-pct)}`);
    document.getElementById("gauge-pct").textContent = `${(ratio*100).toFixed(1)}%`;

    // Calendrier
    if (state.dashboardRange === "monthCal"){
      renderMonthCalendar(state.dashboardYear, state.dashboardMonth, filtered);
    } else {
      renderSequentialCalendar(filtered, state.dashboardRange === "week" ? 7 : 30);
    }

    renderWeeklyRecap();
  }

  function byDateMap(logs){
    const map = {};
    logs.forEach(l=>{ (map[l.log_date] = map[l.log_date] || []).push(l); });
    return map;
  }

  function worstColorForDate(logsForDate){
    const priority = { red:0, orange:1, green:2, empty:3 };
    return logsForDate.map(getColorCode).sort((a,b)=>priority[a]-priority[b])[0];
  }

  // Construit le contenu d'une case du calendrier : le numéro du jour +
  // une petite pastille par catégorie d'objectif travaillée ce jour-là
  // (déduplique, 4 pastilles max pour ne pas surcharger la case).
  function fillCalCell(cell, dayNumber, logsForDay){
    const categories = [];
    (logsForDay || []).forEach(l=>{
      const cat = categoryForLog(l);
      if (!categories.includes(cat)) categories.push(cat);
    });
    const dotsHtml = categories.slice(0,4).map(c=>`<span class="cat-dot" style="background:${categoryColor(c)};" title="${escapeHtml(c)}"></span>`).join("");
    cell.innerHTML = `<span class="cal-day-num">${dayNumber}</span><span class="cat-dots">${dotsHtml}</span>`;
  }

  // Vue "7 jours" / "30 jours" : grille simple, cases dans l'ordre chronologique
  function renderSequentialCalendar(logs, dayCount){
    const weekdayHeader = document.getElementById("cal-weekday-header");
    weekdayHeader.style.display = "none";

    const calGrid = document.getElementById("cal-grid");
    calGrid.innerHTML = "";
    const byDate = byDateMap(logs);

    const dates = [];
    for (let i = dayCount - 1; i >= 0; i--){
      dates.push(isoDaysFromToday(-i));
    }

    dates.forEach(date=>{
      const logsForDay = byDate[date];
      const cell = document.createElement("div");
      cell.className = "cal-cell mono";
      cell.style.background = logsForDay ? COLOR_HEX[worstColorForDate(logsForDay)] : COLOR_HEX.empty;
      cell.style.color = logsForDay ? "#fff" : "var(--muted)";
      cell.title = date;
      fillCalCell(cell, new Date(date+"T00:00:00").getDate(), logsForDay);
      calGrid.appendChild(cell);
    });
  }

  // Vue "Mois" : un seul mois affiché à la fois, calendrier aligné sur les
  // jours de la semaine (lundi -> dimanche), sélectionné via Année + Mois.
  function renderMonthCalendar(year, month, logs){
    const weekdayHeader = document.getElementById("cal-weekday-header");
    weekdayHeader.style.display = "grid";
    weekdayHeader.innerHTML = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d=>`<span>${d}</span>`).join("");

    const calGrid = document.getElementById("cal-grid");
    calGrid.innerHTML = "";
    const byDate = byDateMap(logs);

    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lundi = début de semaine

    for (let i=0; i<leadingBlanks; i++){
      const blank = document.createElement("div");
      blank.className = "cal-cell blank";
      calGrid.appendChild(blank);
    }

    for (let day=1; day<=daysInMonth; day++){
      const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const logsForDay = byDate[dateStr];
      const cell = document.createElement("div");
      cell.className = "cal-cell mono";
      cell.style.background = logsForDay ? COLOR_HEX[worstColorForDate(logsForDay)] : COLOR_HEX.empty;
      cell.style.color = logsForDay ? "#fff" : "var(--muted)";
      cell.title = dateStr;
      fillCalCell(cell, day, logsForDay);
      calGrid.appendChild(cell);
    }
  }

  // =========================================================
  // RÉCAP HEBDO : cette semaine vs. la semaine précédente
  // =========================================================
  function logsInDateWindow(daysAgoStart, daysAgoEnd){
    // daysAgoStart/End en jours avant aujourd'hui (0 = aujourd'hui), bornes incluses
    const start = new Date(); start.setDate(start.getDate() - daysAgoEnd); start.setHours(0,0,0,0);
    const end = new Date(); end.setDate(end.getDate() - daysAgoStart); end.setHours(23,59,59,999);
    return state.dailyLogs.filter(l=>{
      const d = new Date(l.log_date+"T12:00:00");
      return d >= start && d <= end;
    });
  }

  function logsInWindow(daysAgoStart, daysAgoEnd){
    // Comme logsInDateWindow, mais respecte en plus le filtre "objectif" du tableau de bord Résultat.
    return logsInDateWindow(daysAgoStart, daysAgoEnd).filter(l=>
      state.selectedDashboardObjective==="all" || l.objective_id===state.selectedDashboardObjective
    );
  }

  function recapDeltaHtml(current, previous, suffix){
    const delta = Math.round((current - previous) * 10) / 10;
    const cls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const sign = delta > 0 ? "+" : "";
    return `<span class="recap-delta ${cls}">${sign}${delta}${suffix}</span>`;
  }

  function renderWeeklyRecap(){
    const wrap = document.getElementById("weekly-recap");
    const currentWeek = logsInWindow(0, 6);
    const previousWeek = logsInWindow(7, 13);

    if (currentWeek.length === 0 && previousWeek.length === 0){
      wrap.innerHTML = '<p class="muted" style="font-size:13px;">Pas encore assez de check-ins pour comparer.</p>';
      return;
    }

    const curDiscipline = computeDiscipline(currentWeek);
    const prevDiscipline = computeDiscipline(previousWeek);
    const curPerf = computePerformance(currentWeek);
    const prevPerf = computePerformance(previousWeek);
    const curHours = computeHoursRatio(currentWeek).actual;
    const prevHours = computeHoursRatio(previousWeek).actual;

    wrap.innerHTML = `
      <div class="recap-row">
        <span class="recap-label">Discipline</span>
        <span class="recap-values">${curDiscipline.toFixed(1)}% ${recapDeltaHtml(curDiscipline, prevDiscipline, " pts")}</span>
      </div>
      <div class="recap-row">
        <span class="recap-label">Performance</span>
        <span class="recap-values">${curPerf.toFixed(1)}% ${recapDeltaHtml(curPerf, prevPerf, " pts")}</span>
      </div>
      <div class="recap-row">
        <span class="recap-label">Heures réalisées</span>
        <span class="recap-values">${curHours.toFixed(1)}h ${recapDeltaHtml(curHours, prevHours, "h")}</span>
      </div>
    `;
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // =========================================================
  // SALUTATION + PROFIL
  // =========================================================
  function renderGreeting(){
    const name = state.profile.firstName.trim();
    document.getElementById("greeting").textContent = name ? `Hello ${name}` : "Hello";
  }

  // Sélecteur d'année dans l'en-tête : chaque année a ses objectifs — on
  // filtre les listes d'objectifs (Target, Archive) sur celle choisie.
  function renderAppYearSelector(){
    const select = document.getElementById("app-year-select");
    const years = knownYears();
    if (state.selectedAppYear === "all" || !state.selectedAppYear){
      state.selectedAppYear = String(new Date().getFullYear());
    }
    const selectedYearNum = parseInt(state.selectedAppYear);
    if (!years.includes(selectedYearNum)) years.push(selectedYearNum);
    years.sort((a,b)=>a-b);

    select.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
    select.value = state.selectedAppYear;
    select.onchange = ()=>{ state.selectedAppYear = select.value; renderAll(); };
  }

  function goToNextYear(){
    const next = parseInt(state.selectedAppYear) + 1;
    state.selectedAppYear = String(next);
    renderAll();
  }

  document.getElementById("next-year-btn").addEventListener("click", goToNextYear);

  function objectiveMatchesSelectedYear(obj){
    if (state.selectedAppYear === "all") return true;
    const year = parseInt(state.selectedAppYear);
    const startYear = obj.start_date ? new Date(obj.start_date+"T00:00:00").getFullYear() : -Infinity;
    const endYear = obj.target_date ? new Date(obj.target_date+"T00:00:00").getFullYear() : Infinity;
    return year >= startYear && year <= endYear;
  }

  function renderProfile(){
    document.getElementById("profile-firstname").value = state.profile.firstName;
    document.getElementById("profile-email").value = state.profile.email;
    document.getElementById("reminder-enabled").checked = state.reminder.enabled;
    document.getElementById("reminder-time").value = state.reminder.time;
    document.getElementById("reminder-timezone").value = state.reminder.timezone || "Europe/Paris";
    const prayerSelect = document.getElementById("prayer-city");
    if (prayerSelect && prayerSelect.options.length === 0){
      PRAYER_CITIES.forEach(c=>{
        const opt = document.createElement("option");
        opt.value = c.value; opt.textContent = c.label;
        prayerSelect.appendChild(opt);
      });
    }
    if (prayerSelect) prayerSelect.value = state.prayerCity || "";
    const prayerEnabledCheckbox = document.getElementById("prayer-enabled");
    if (prayerEnabledCheckbox) prayerEnabledCheckbox.checked = !!state.prayerEnabled;
    renderPrayerTimesToday();
  }

  document.getElementById("prayer-save")?.addEventListener("click", async ()=>{
    const msg = document.getElementById("prayer-message");
    msg.classList.remove("error", "success");
    const cityValue = document.getElementById("prayer-city").value;
    const enabledValue = !!document.getElementById("prayer-enabled")?.checked;
    state.prayerCity = cityValue;
    state.prayerEnabled = enabledValue;
    if (SUPABASE_CONFIGURED){
      try { await db.upsertProfile(state.userId, { prayer_city: cityValue || null, prayer_enabled: enabledValue }); }
      catch(err){ msg.textContent = "Erreur : " + err.message; msg.classList.add("error"); return; }
    }
    msg.textContent = !enabledValue ? "Prières désactivées : elles ne s'affichent plus."
      : cityValue ? "Ville enregistrée, calcul des horaires du jour…"
      : "Choisissez une ville pour activer les prières.";
    msg.classList.add("success");
    weatherTipDate = null; // la ville a changé : on redemande la météo
    if (enabledValue && cityValue) { await syncPrayerTimesForToday(); renderWeatherTip(); }
    else { renderPrayerTimesToday(); renderCheckin(); renderAgenda(); if (cityValue) renderWeatherTip(); }
  });

  const profileForm = document.getElementById("profile-form");
  profileForm.addEventListener("submit", async e=>{
    e.preventDefault();
    const msg = document.getElementById("profile-message");
    msg.classList.remove("error", "success");

    const firstName = document.getElementById("profile-firstname").value.trim();
    const email = document.getElementById("profile-email").value.trim();
    const currentPassword = document.getElementById("profile-current-password").value;
    const newPassword = document.getElementById("profile-new-password").value;
    const confirmPassword = document.getElementById("profile-confirm-password").value;

    const wantsPasswordChange = newPassword.length > 0 || confirmPassword.length > 0;
    if (wantsPasswordChange){
      if (newPassword !== confirmPassword){
        msg.textContent = "Le nouveau mot de passe et sa confirmation ne correspondent pas.";
        msg.classList.add("error");
        return;
      }
      if (newPassword.length < 6){
        msg.textContent = "Le nouveau mot de passe doit faire au moins 6 caractères.";
        msg.classList.add("error");
        return;
      }
      if (!SUPABASE_CONFIGURED && state.profile.password && currentPassword !== state.profile.password){
        msg.textContent = "Le mot de passe actuel est incorrect.";
        msg.classList.add("error");
        return;
      }
    }

    if (SUPABASE_CONFIGURED){
      try {
        // Ré-authentification avec le mot de passe actuel avant de changer le mot de passe
        if (wantsPasswordChange){
          if (!currentPassword){
            msg.textContent = "Renseignez votre mot de passe actuel pour le changer.";
            msg.classList.add("error");
            return;
          }
          const { error: reauthError } = await supabaseClient.auth.signInWithPassword({ email: state.profile.email, password: currentPassword });
          if (reauthError){
            msg.textContent = "Le mot de passe actuel est incorrect.";
            msg.classList.add("error");
            return;
          }
        }

        const authPatch = {};
        if (wantsPasswordChange) authPatch.password = newPassword;
        if (email && email !== state.profile.email) authPatch.email = email;
        if (Object.keys(authPatch).length > 0){
          const { error: updateError } = await supabaseClient.auth.updateUser(authPatch);
          if (updateError) throw updateError;
        }

        await db.upsertProfile(state.userId, { first_name: firstName });
      } catch(err){
        msg.textContent = "Erreur : " + err.message;
        msg.classList.add("error");
        return;
      }
    }

    state.profile.firstName = firstName || state.profile.firstName;
    state.profile.email = email;
    if (wantsPasswordChange) state.profile.password = newPassword;

    document.getElementById("profile-current-password").value = "";
    document.getElementById("profile-new-password").value = "";
    document.getElementById("profile-confirm-password").value = "";

    msg.textContent = SUPABASE_CONFIGURED && email !== state.profile.email
      ? "Profil enregistré. Un email de confirmation a été envoyé pour valider la nouvelle adresse."
      : "Profil enregistré.";
    msg.classList.add("success");
    renderGreeting();
  });

  // =========================================================
  // RAPPEL DU SOIR
  // =========================================================
  // Fonctionne via l'API Notification du navigateur, tant que cet onglet
  // reste ouvert. Une vraie notification "push" en arrière-plan demanderait
  // un service worker + un serveur — hors périmètre d'un fichier unique.
  let reminderIntervalId = null;
  let reminderFiredForToday = null; // évite de spammer plusieurs fois le même jour

  function todaysUnfinishedCount(){
    const dow = new Date().getDay();
    const todaysRoutines = state.routines.filter(r=>r.day_of_week===dow);
    const date = todayISO();
    const doneCount = todaysRoutines.filter(r=>{
      const log = state.dailyLogs.find(l=>l.routine_id===r.id && l.log_date===date);
      return log && log.status !== "not_done" && log.actual_hours > 0;
    }).length;
    return todaysRoutines.length - doneCount;
  }

  function startReminderChecker(){
    if (reminderIntervalId) clearInterval(reminderIntervalId);
    reminderIntervalId = setInterval(()=>{
      if (!state.reminder.enabled) return;
      if (!("Notification" in window) || Notification.permission !== "granted") return;

      const now = new Date();
      const currentHHMM = String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");
      if (currentHHMM !== state.reminder.time) return;

      const today = todayISO();
      if (reminderFiredForToday === today) return; // déjà envoyé aujourd'hui

      const remaining = todaysUnfinishedCount();
      if (remaining <= 0) return; // journée déjà bouclée, pas besoin de relancer

      new Notification("JamsPlans : Check-in du soir", {
        body: remaining === 1
          ? "Il te reste 1 tâche à valider aujourd'hui."
          : `Il te reste ${remaining} tâches à valider aujourd'hui.`,
      });
      reminderFiredForToday = today;
    }, 20000); // vérifie toutes les 20s
  }

  document.getElementById("reminder-save").addEventListener("click", async ()=>{
    const msg = document.getElementById("reminder-message");
    msg.classList.remove("error", "success");
    const enabled = document.getElementById("reminder-enabled").checked;
    const time = document.getElementById("reminder-time").value || "20:00";
    const webhookUrl = JAMSPLANS_MAKE_WEBHOOK_URL;
    const timezone = document.getElementById("reminder-timezone").value;

    if (enabled && "Notification" in window && Notification.permission !== "granted"){
      const permission = await Notification.requestPermission();
      if (permission !== "granted"){
        msg.textContent = "Notifications refusées par le navigateur. Le rappel ne pourra pas s'afficher.";
        msg.classList.add("error");
      }
    }

    state.reminder.enabled = enabled;
    state.reminder.time = time;
    state.reminder.timezone = timezone;
    state.reminder.webhookUrl = webhookUrl;
    // Le SMS est momentanément retiré (pas de numéro Twilio disponible) :
    // le rappel part uniquement par mail tant que ce n'est pas réactivé.
    state.reminder.channelEmail = true;
    state.reminder.channelSms = false;
    reminderFiredForToday = null;

    if (SUPABASE_CONFIGURED){
      try {
        await db.upsertProfile(state.userId, {
          reminder_enabled: enabled, reminder_time: time, timezone,
          reminder_webhook_url: webhookUrl || null,
          reminder_channel_email: true, reminder_channel_sms: false,
          // Colonne historique conservée pour compat ; plus utilisée pour l'envoi.
          reminder_channel: "email",
        });
      }
      catch(err){ msg.textContent = "Erreur : " + err.message; msg.classList.add("error"); return; }
    }

    if (!msg.textContent){
      msg.textContent = "Rappel enregistré (navigateur + Make.com, par mail).";
      msg.classList.add("success");
    }
  });

  document.getElementById("reminder-test")?.addEventListener("click", async ()=>{
    const msg = document.getElementById("reminder-message");
    msg.classList.remove("error", "success");
    const webhookUrl = JAMSPLANS_MAKE_WEBHOOK_URL;

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: state.userId || "test",
          firstName: state.profile.firstName || "",
          email: state.profile.email || null,
          phone: null,
          channelEmail: true, channelSms: false,
          remaining: 1,
          message: "Ceci est un test de rappel JamsPlans.",
          date: todayISO(),
        }),
      });
      if (!res.ok) throw new Error("Réponse HTTP " + res.status);
      msg.textContent = "Test envoyé au webhook Make.com — vérifie la réception par mail.";
      msg.classList.add("success");
    } catch(err){
      msg.textContent = "Échec de l'envoi du test : " + err.message;
      msg.classList.add("error");
    }
  });

  // =========================================================
  // LIMITES HEBDOMADAIRES PAR CATÉGORIE
  // Section "Limites hebdomadaires" retirée du Profil à la demande de
  // l'utilisateur (knownCategories / hoursUsedThisWeekByCategory /
  // renderWeeklyLimits / le bouton limits-save ont été supprimés).
  function renderAll(){
    renderGreeting();
    renderAppYearSelector();
    renderPlanning();
    renderAgenda();
    renderCheckin();
    renderDashboard();
    renderProfile();
  }

  // =========================================================
  // AUTHENTIFICATION (uniquement si Supabase est configuré)
  // =========================================================
  let authMode = "signin"; // "signin" | "signup" | "delete"

  document.querySelectorAll("#auth-tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      authMode = btn.dataset.authMode;
      document.querySelectorAll("#auth-tabs button").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("auth-submit").textContent =
        authMode === "signin" ? "Se connecter"
        : authMode === "signup" ? "Créer un compte"
        : "Supprimer définitivement mon compte";
      document.getElementById("auth-message").textContent = "";
      const isSignup = authMode === "signup";
      document.querySelectorAll(".auth-signup-only").forEach(el=>{
        el.style.display = isSignup ? "block" : "none";
        el.required = isSignup;
      });
      const isDelete = authMode === "delete";
      document.querySelectorAll(".auth-delete-only").forEach(el=>{ el.style.display = isDelete ? "flex" : "none"; });
      const confirmBox = document.getElementById("auth-delete-confirm");
      if (confirmBox) confirmBox.checked = false;
    });
  });

  document.getElementById("auth-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const msg = document.getElementById("auth-message");
    msg.classList.remove("error", "success");
    msg.textContent = "";

    try {
      if (authMode === "delete"){
        if (!document.getElementById("auth-delete-confirm").checked){
          msg.textContent = "Coche la case de confirmation pour supprimer ton compte.";
          msg.classList.add("error");
          return;
        }
        // On revérifie le mot de passe ici (même si l'utilisateur est déjà
        // connecté par ailleurs) pour ne jamais supprimer un compte sans
        // confirmation explicite des identifiants.
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const res = await fetch("/api/delete-account", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.session.access_token },
        });
        const body = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(body.error || "La suppression du compte a échoué.");
        await supabaseClient.auth.signOut();
        msg.textContent = "Compte supprimé définitivement. À bientôt peut-être.";
        msg.classList.add("success");
        document.getElementById("auth-form").reset();
        return;
      }
      if (authMode === "signin"){
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await enterApp(data.session);
      } else {
        const firstName = document.getElementById("auth-firstname").value.trim();
        const phone = document.getElementById("auth-phone").value.trim();
        const { data, error } = await supabaseClient.auth.signUp({
          email, password,
          options: { data: { first_name: firstName, phone: phone || null } },
        });
        if (error) throw error;
        if (!data.session){
          msg.textContent = "Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.";
          msg.classList.add("success");
          return;
        }
        // Filet de sécurité : si le trigger handle_new_user (déclenché à l'inscription)
        // n'a pas encore posé prénom/téléphone au moment où on lit le profil dans
        // enterApp, on les renvoie explicitement ici.
        if (firstName || phone){
          try { await db.upsertProfile(data.session.user.id, { first_name: firstName || undefined, phone: phone || undefined }); }
          catch(_e){ /* pas bloquant : enterApp rechargera de toute façon le profil */ }
        }
        await enterApp(data.session);
      }
    } catch(err){
      msg.textContent = err.message;
      msg.classList.add("error");
    }
  });

  document.getElementById("auth-forgot-link").addEventListener("click", async ()=>{
    const emailField = document.getElementById("auth-email");
    const msg = document.getElementById("auth-message");
    msg.classList.remove("error", "success");
    const email = emailField.value.trim();
    if (!email){
      msg.textContent = "Renseignez votre adresse mail ci-dessus, puis cliquez de nouveau sur ce lien.";
      msg.classList.add("error");
      emailField.focus();
      return;
    }
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      msg.textContent = "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé.";
      msg.classList.add("success");
    } catch(err){
      msg.textContent = "Erreur : " + err.message;
      msg.classList.add("error");
    }
  });

  // Quand la personne clique sur le lien recu par email, Supabase la ramene
  // ici avec un événement PASSWORD_RECOVERY : on lui demande alors directement
  // son nouveau mot de passe via une simple invite, puis on l'enregistre.
  if (SUPABASE_CONFIGURED){
    supabaseClient.auth.onAuthStateChange(async (event, session)=>{
      if (event === "PASSWORD_RECOVERY" && session){
        const newPassword = window.prompt("Choisissez votre nouveau mot de passe (6 caractères minimum) :");
        if (!newPassword) return;
        if (newPassword.length < 6){
          showToast("Le nouveau mot de passe doit faire au moins 6 caractères.", "error");
          return;
        }
        try {
          const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
          if (error) throw error;
          showToast("Mot de passe mis à jour. Vous êtes connecté.", "success");
          await enterApp(session);
        } catch(err){
          showToast("Erreur lors de la mise à jour du mot de passe : " + err.message, "error");
        }
      }
    });
  }

  document.getElementById("signout-btn").addEventListener("click", async ()=>{
    if (SUPABASE_CONFIGURED) await supabaseClient.auth.signOut();
    if (reminderIntervalId) clearInterval(reminderIntervalId);
    document.getElementById("app-root").style.display = "none";
    document.getElementById("auth-screen").style.display = "flex";
    document.getElementById("auth-email").value = "";
    document.getElementById("auth-password").value = "";
  });

  async function enterApp(session){
    state.userId = session.user.id;
    state.profile.email = session.user.email || "";
    // Filet de sécurité : si jamais l'objet session ne portait pas encore
    // l'email (selon la méthode de connexion), on le récupère explicitement.
    if (!state.profile.email){
      try {
        const { data: freshUser } = await supabaseClient.auth.getUser();
        if (freshUser && freshUser.user && freshUser.user.email){
          state.profile.email = freshUser.user.email;
        }
      } catch(e){ /* ignore, on retente juste avec ce qu'on a */ }
    }
    try {
      const loaded = await db.fetchAll(state.userId);
      state.objectives = loaded.objectives;
      state.routines = loaded.routines;
      state.agendaTasks = loaded.agendaTasks;
      state.dailyLogs = loaded.dailyLogs;
      if (loaded.profile){
        state.profile.firstName = loaded.profile.first_name || state.profile.firstName;
        state.reminder.enabled = !!loaded.profile.reminder_enabled;
        state.reminder.time = (loaded.profile.reminder_time || "20:00").slice(0,5);
        state.reminder.timezone = loaded.profile.timezone || "Europe/Paris";
        state.reminder.webhookUrl = loaded.profile.reminder_webhook_url || JAMSPLANS_MAKE_WEBHOOK_URL;
        // SMS retiré pour l'instant (pas de numéro Twilio) : uniquement mail.
        state.reminder.channelEmail = true;
        state.reminder.channelSms = false;
        state.prayerCity = loaded.profile.prayer_city || "";
        state.prayerEnabled = !!loaded.profile.prayer_enabled;
        state.weeklyLimits = loaded.profile.weekly_limits || {};
        // Le bouton "Par défaut" a été retiré de l'interface : on ne crée
        // plus de période de repli sans dates. Une éventuelle ancienne
        // période "Par défaut" déjà enregistrée reste dans les données (pas
        // de perte), mais n'est plus jamais sélectionnée automatiquement.
        const loadedTemplates = loaded.profile.day_template;
        state.dayTemplates = Array.isArray(loadedTemplates) ? loadedTemplates : [];
        if (dedupeDayTemplateIds()) saveDayTemplates();
        const todaysTpl = getTemplateForDate(todayISO());
        const datedTemplates = state.dayTemplates.filter(t=>t.period_start && t.period_end);
        state.activeDayTemplateId = todaysTpl ? todaysTpl.id : (datedTemplates[0] ? datedTemplates[0].id : null);
      }
      state.selectedPlanningObjective = state.objectives[0]?.id || null;
    } catch(err){
      showToast("Erreur lors du chargement des données : " + err.message, "error");
    }
    startReminderChecker();
    document.getElementById("auth-screen").style.display = "none";
    document.getElementById("app-root").style.display = "block";
    document.getElementById("signout-btn").style.display = "inline";
    renderAll();
    // Régénère au besoin les horaires de prière du jour (pas d'appel si déjà
    // faites aujourd'hui) — après renderAll() pour ne pas retarder l'affichage.
    syncPrayerTimesForToday();
  }

  async function bootstrap(){
    if (!SUPABASE_CONFIGURED){
      document.getElementById("app-root").style.display = "block";
      document.getElementById("auth-screen").style.display = "none";
      renderAll();
      startReminderChecker();
      return;
    }
    document.getElementById("app-root").style.display = "none";
    document.getElementById("auth-screen").style.display = "flex";
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session){
      await enterApp(session);
    }
  }

  bootstrap();
}
