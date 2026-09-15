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
    async upsertDailyLog(userId, payload){
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
    return { ...row, currentYear: row.current_year, history: row.history || [] };
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
  function categoryOfObjective(objectiveId){
    const obj = state.objectives.find(o=>o.id===objectiveId);
    return obj ? (obj.category || "Autre") : "Autre";
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

  let uid = 0;
  const nextId = () => "id-" + (++uid);

  function todayISO(){ return new Date().toISOString().slice(0,10); }

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
  function isoDaysFromToday(offsetDays){
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0,10);
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
    reminder: { enabled: false, time: "20:00", phone: "", timezone: "Europe/Paris", webhookUrl: "", channel: "email" },
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
    activeDayTemplateId: "tpl-default",
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
    document.getElementById("obj-hours").value = "10";
    document.getElementById("obj-category-custom").value = "";
    document.getElementById("obj-category-custom").style.display = "none";
    document.getElementById("obj-category").value = "Étude";
    document.getElementById("obj-submit-btn").textContent = "+ Ajouter";
    document.getElementById("obj-cancel-edit-btn").style.display = "none";
  }

  function startEditingObjective(obj){
    editingObjectiveId = obj.id;
    document.getElementById("obj-title").value = obj.title;
    const isStandard = STANDARD_CATEGORIES.includes(obj.category);
    document.getElementById("obj-category").value = isStandard ? obj.category : "__custom";
    document.getElementById("obj-category-custom").style.display = isStandard ? "none" : "block";
    document.getElementById("obj-category-custom").value = isStandard ? "" : (obj.category || "");
    document.getElementById("obj-start-date").value = obj.start_date || "";
    document.getElementById("obj-date").value = obj.target_date || "";
    document.getElementById("obj-hours").value = obj.weekly_hours_target;
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
    const date = document.getElementById("obj-date").value;
    const hours = parseFloat(document.getElementById("obj-hours").value) || 0;
    const year = date ? new Date(date+"T00:00:00").getFullYear() : new Date().getFullYear();

    if (editingObjectiveId){
      const existing = state.objectives.find(o=>o.id===editingObjectiveId);
      if (!existing) { resetObjectiveForm(); return; }
      const patch = { title, category, start_date: startDate || null, target_date: date || null, weekly_hours_target: hours };
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

    const draft = { title, category, start_date: startDate || null, target_date: date || null, weekly_hours_target: hours, achieved: false, history: [], currentYear: year };

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
    const hours = parseFloat(document.getElementById("agenda-hours").value) || 0;
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
      // Même règle que pour les blocs de la journée type : pas de chevauchement
      // avec un créneau déjà posé — sauf pour les petites tâches sans horaire,
      // qui ne passent jamais par cette vérification.
      const overlapping = findOverlappingBlock(planningStart, planningEnd, null);
      if (overlapping){
        showToast(`Ce créneau chevauche "${overlapping.label}" (${overlapping.start}–${overlapping.end}) dans la Journée type.`, "error");
        return;
      }
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
    if (state.agendaTasks.length === 0){
      list.innerHTML = emptyStateHtml("Aucune tâche pour l'instant. Ajoutez-en une ci-dessus.");
      return;
    }

    const byDate = {};
    state.agendaTasks.forEach(t=>{ (byDate[t.start_date] = byDate[t.start_date] || []).push(t); });
    const dates = Object.keys(byDate).sort();

    list.innerHTML = dates.map(date=>{
      const dateFmt = new Date(date+"T00:00:00").toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
      const items = byDate[date].map(t=>{
        const cat = t.objective_id ? categoryOfObjective(t.objective_id) : "Agenda";
        const rangeText = t.end_date && t.end_date !== t.start_date ? ` → ${formatDateFr(t.end_date)}` : "";
        const slotText = t.planning_start && t.planning_end ? ` · ${t.planning_start}–${t.planning_end}` : "";
        return `
          <div class="agenda-item">
            <div>
              <span class="cat-badge" style="background:${categoryColor(cat)};">${escapeHtml(cat)}</span>${t.is_priority ? '<span class="priority-badge">Prioritaire</span>' : ""}
              <div style="margin-top:4px;">${escapeHtml(t.label)}</div>
              <div class="agenda-meta">${t.planned_hours}h${rangeText}${slotText}</div>
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

        const dateRangeText = formatDateRangeFr(obj.start_date, obj.target_date);

        const progressHtml = objectiveProgressHtml(obj);

        li.innerHTML = `
          <div style="display:flex; align-items:flex-start; justify-content:space-between; width:100%;">
            <div style="flex:1;">
              <div class="obj-title">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span>${obj.achieved ? '<span class="achieved-badge">atteint</span>' : ""}</div>
              <div class="obj-meta">${obj.weekly_hours_target}h / semaine${dateRangeText ? " · "+dateRangeText : ""}</div>
              ${progressHtml}
              ${historyHtml}
            </div>
            <button class="del-btn" title="Supprimer">Suppr.</button>
          </div>
          <div style="display:flex; gap:12px; align-items:center;">
            <button class="achieve-toggle">${obj.achieved ? "Marquer non atteint" : "Marquer atteint"}</button>
            <button class="continue-btn edit-obj-btn">Modifier</button>
            ${!obj.achieved ? '<button class="continue-btn continue-year-btn">Poursuivre en N+1</button>' : ""}
          </div>
        `;
        li.querySelector(".del-btn").addEventListener("click", ()=>deleteObjective(obj.id));
        li.querySelector(".edit-obj-btn").addEventListener("click", ()=>startEditingObjective(obj));
        li.querySelector(".achieve-toggle").addEventListener("click", async ()=>{
          const nextAchieved = !obj.achieved;
          if (SUPABASE_CONFIGURED){
            try { const updated = await db.updateObjective(obj.id, { achieved: nextAchieved }); Object.assign(obj, updated); }
            catch(err){ showToast("Erreur : " + err.message, "error"); return; }
          } else {
            obj.achieved = nextAchieved;
          }
          renderAll();
        });
        const continueBtn = li.querySelector(".continue-year-btn");
        if (continueBtn){
          continueBtn.addEventListener("click", ()=>continueObjectiveToNextYear(obj.id));
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

  // Bannière d'alerte au-dessus de la liste d'objectifs : chevauchements de
  // dates + rappel personnalisé si trop d'objectifs sont menés de front.
  function renderObjectiveAlerts(pursuedObjectives){
    const wrap = document.getElementById("objective-alerts");
    if (!wrap) return;
    const alerts = [];

    if (pursuedObjectives.length >= 3){
      const name = (state.profile.firstName || "").trim();
      alerts.push(`<p class="limit-alert">Attention${name ? " " + escapeHtml(name) : ""}, tu suis ${pursuedObjectives.length} objectifs à la fois. Ne te disperse pas, il est conseillé de se concentrer sur 1 ou 2 à la fois.</p>`);
    }

    const overlaps = findOverlappingObjectivePairs(pursuedObjectives);
    overlaps.forEach(([a,b])=>{
      alerts.push(`<p class="limit-alert">Les objectifs "${escapeHtml(a.title)}" et "${escapeHtml(b.title)}" se chevauchent (${formatDateRangeFr(a.start_date, a.target_date)} / ${formatDateRangeFr(b.start_date, b.target_date)}).</p>`);
    });

    wrap.innerHTML = alerts.join("");
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
      if (!o.start_date || !o.target_date) return false;
      const s = new Date(o.start_date+"T00:00:00").getTime();
      const e = new Date(o.target_date+"T00:00:00").getTime();
      return e >= yearStart && s < yearEnd;
    });

    if (objectives.length === 0){
      wrap.innerHTML = emptyStateHtml(`Aucun objectif avec des dates couvrant ${year}.`);
      return;
    }

    const monthLabelsHtml = MONTH_NAMES_SHORT.map(m=>`<span>${m}</span>`).join("");

    const rowsHtml = objectives.map(obj=>{
      const s = Math.max(new Date(obj.start_date+"T00:00:00").getTime(), yearStart);
      const e = Math.min(new Date(obj.target_date+"T00:00:00").getTime(), yearEnd);
      const leftPct = ((s - yearStart) / yearSpan) * 100;
      const widthPct = Math.max(((e - s) / yearSpan) * 100, 1);
      const time = objectiveTimeProgress(obj);
      const pct = time ? time.pct : 0;
      return `
        <div class="gantt-row">
          <div class="gantt-row-label">${escapeHtml(obj.title)}<span class="cat-badge" style="background:${categoryColor(obj.category || "Autre")};">${escapeHtml(obj.category || "Autre")}</span></div>
          <div class="gantt-track">
            <div class="gantt-bar" style="left:${leftPct}%; width:${widthPct}%;">
              <div class="gantt-bar-fill" style="width:${pct}%;"></div>
              <span class="gantt-bar-pct">${pct}%</span>
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
    const failures = state.objectives.filter(o=>!o.achieved && o.target_date && o.target_date < today && objectiveMatchesSelectedYear(o));

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
            <div class="obj-meta">${obj.weekly_hours_target}h / semaine${dateRangeText ? " · "+dateRangeText : ""}</div>
            ${objectiveProgressHtml(obj)}
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
            <div class="obj-meta">${obj.weekly_hours_target}h / semaine · échéance dépassée (${formatDateFr(obj.target_date)})</div>
            ${objectiveProgressHtml(obj)}
          </div>
          <div style="display:flex; gap:12px;">
            <button class="achieve-toggle">Marquer atteint</button>
            <button class="continue-btn edit-obj-btn">Modifier</button>
            <button class="continue-btn continue-year-btn">Poursuivre en N+1</button>
          </div>
        `;
        li.querySelector(".achieve-toggle").addEventListener("click", async ()=>{
          if (SUPABASE_CONFIGURED){
            try { const updated = await db.updateObjective(obj.id, { achieved: true }); Object.assign(obj, updated); }
            catch(err){ showToast("Erreur : " + err.message, "error"); return; }
          } else {
            obj.achieved = true;
          }
          renderAll();
        });
        li.querySelector(".edit-obj-btn").addEventListener("click", ()=>startEditingObjective(obj));
        li.querySelector(".continue-year-btn").addEventListener("click", ()=>continueObjectiveToNextYear(obj.id));
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
      <div>
        <label class="field-label" for="routine-day">Jour</label>
        <select id="routine-day"></select>
      </div>
      <div style="flex:1; min-width:140px;">
        <label class="field-label" for="routine-label">Tâche</label>
        <input id="routine-label" placeholder="Ex : Comptabilité" />
      </div>
      <div>
        <label class="field-label" for="routine-hours">Durée</label>
        <div class="hours-input"><input id="routine-hours" type="number" min="0" step="0.5" value="2" /><span class="muted" style="font-size:12px;">h</span></div>
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
    const daySelect = form.querySelector("#routine-day");
    DAYS.forEach(d=>{
      const opt = document.createElement("option");
      opt.value = d.value; opt.textContent = d.label;
      daySelect.appendChild(opt);
    });
    form.addEventListener("submit", async e=>{
      e.preventDefault();
      const label = form.querySelector("#routine-label").value.trim();
      if (!label) return;
      const draft = {
        objective_id: objId,
        day_of_week: parseInt(daySelect.value),
        label,
        planned_hours: parseFloat(form.querySelector("#routine-hours").value) || 0,
        is_priority: form.querySelector("#routine-priority").checked,
        start_time: form.querySelector("#routine-start-time").value || null,
        end_time: form.querySelector("#routine-end-time").value || null,
      };
      if (SUPABASE_CONFIGURED){
        try { state.routines.push(await db.insertRoutine(state.userId, draft)); }
        catch(err){ showToast("Erreur lors de l'ajout du créneau : " + err.message, "error"); return; }
      } else {
        state.routines.push({ id: nextId(), ...draft });
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
    for (const block of (blocks || getActiveTemplate().blocks)){
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

  function getActiveTemplate(){
    return state.dayTemplates.find(t=>t.id===state.activeDayTemplateId) || state.dayTemplates[0];
  }

  // Retrouve la journée type applicable à une date donnée : celle dont la
  // période (début->fin) couvre cette date, sinon celle "toujours active"
  // (sans période définie), sinon la première disponible.
  function getTemplateForDate(dateStr){
    const specific = state.dayTemplates.find(t=>
      t.period_start && t.period_end && dateStr >= t.period_start && dateStr <= t.period_end
    );
    if (specific) return specific;
    return state.dayTemplates.find(t=>!t.period_start && !t.period_end) || state.dayTemplates[0];
  }

  // Anneau 24h : chaque bloc devient un segment coloré positionné par angle.
  // L'anneau se remplit visuellement à mesure que des heures sont bloquées ;
  // les trous restés couleur neutre = temps non planifié. Purement visuel :
  // pour modifier ou supprimer un bloc, on passe par les boutons de la légende.
  function renderDayTemplateRing(){
    const wrap = document.getElementById("day-template-ring");
    const size = 260, cx = 130, cy = 130, r = 88, sw = 20;
    const C = 2 * Math.PI * r;
    const blocks = getActiveTemplate().blocks;

    const segments = [];
    blocks.forEach(block=>{
      const startMin = timeToMinutes(block.start);
      const endMin = timeToMinutes(block.end);
      if (endMin > startMin){
        segments.push({ block, startMin, lenMin: endMin - startMin });
      } else {
        // Le bloc chevauche minuit (ex: 23:00 -> 08:00) -> deux segments
        segments.push({ block, startMin, lenMin: 1440 - startMin });
        segments.push({ block, startMin: 0, lenMin: endMin });
      }
    });

    const totalBlockedMin = segments.reduce((s,seg)=>s+seg.lenMin, 0);
    const totalHours = Math.round((totalBlockedMin/60)*10)/10;

    const segmentsHtml = segments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*C;
      const dashoffset = C*(1-startFrac);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${categoryColor(seg.block.label)}" stroke-width="${sw}"
        stroke-dasharray="${arcLen} ${C-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})" class="dt-ring-seg" data-block-id="${seg.block.id}">
        <title>${escapeHtml(seg.block.label)} (${seg.block.start} à ${seg.block.end})</title>
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
    const blocks = getActiveTemplate().blocks;
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
    const blocks = [...getActiveTemplate().blocks].sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));
    if (blocks.length === 0){
      legend.innerHTML = '<p class="muted" style="font-size:13px;">Aucune plage définie pour cette période.</p>';
      return;
    }
    legend.innerHTML = blocks.map(b=>`
      <div class="dt-legend-item" data-block-id="${b.id}">
        <span class="dt-swatch" style="background:${categoryColor(b.label)};"></span>
        <span>${escapeHtml(b.label)}</span>
        <span class="mono muted">${b.start}–${b.end}</span>
        <span style="display:flex; gap:8px; margin-left:auto;">
          <button type="button" class="achieve-toggle dt-edit-btn" style="margin-top:0;">Modifier</button>
          <button type="button" class="del-btn dt-delete-btn">Supprimer</button>
        </span>
      </div>
    `).join("");

    legend.querySelectorAll(".dt-edit-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.closest("[data-block-id]").dataset.blockId;
        const block = getActiveTemplate().blocks.find(b=>b.id===id);
        if (!block) return;
        editingDayTemplateBlockId = id;
        document.getElementById("dt-start").value = block.start;
        document.getElementById("dt-end").value = block.end;
        document.getElementById("dt-label").value = block.label;
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
    document.getElementById("dt-submit-btn").textContent = "+ Ajouter";
    document.getElementById("dt-cancel-edit-btn").style.display = "none";
  }

  document.getElementById("dt-cancel-edit-btn").addEventListener("click", cancelDayTemplateEdit);

  // Pills de sélection de période + formulaire de création d'une nouvelle
  // journée type bornée à une plage de dates.
  function renderDayTemplatePeriods(){
    const wrap = document.getElementById("day-template-periods");
    wrap.innerHTML = state.dayTemplates.map(t=>{
      const rangeText = t.period_start && t.period_end ? formatDateRangeFr(t.period_start, t.period_end) : "toujours";
      const active = t.id === state.activeDayTemplateId ? " active" : "";
      return `<button type="button" class="pill${active}" data-tpl-id="${t.id}">${escapeHtml(t.name)} <span class="muted" style="font-size:10.5px;">(${rangeText})</span></button>`;
    }).join("") + `<button type="button" id="new-period-btn" class="pill">+ Nouvelle période</button>`;

    wrap.querySelectorAll("[data-tpl-id]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        state.activeDayTemplateId = btn.dataset.tplId;
        renderDayTemplate();
      });
    });
    document.getElementById("new-period-btn").addEventListener("click", ()=>{
      const panel = document.getElementById("new-period-form");
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    });
  }

  function renderDayTemplate(){
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

  async function deleteDayTemplateBlock(id){
    getActiveTemplate().blocks = getActiveTemplate().blocks.filter(b=>b.id!==id);
    await saveDayTemplates();
    renderDayTemplate();
  }

  // Le résumé du jour et la check-liste concernent toujours "aujourd'hui" ;
  // on les masque tant que "Consulter un jour" est ouvert, pour ne pas
  // mélanger les deux dans le même écran.
  function syncTodayViewsVisibility(){
    const consultOpen = document.getElementById("day-consult-panel").style.display === "block";
    document.getElementById("checkin-summary").style.display = consultOpen ? "none" : "block";
    document.getElementById("checkin-list").style.display = consultOpen ? "none" : "block";
  }

  document.getElementById("day-template-toggle").addEventListener("click", ()=>{
    const panel = document.getElementById("day-template-panel");
    const isHidden = panel.style.display === "none" || !panel.style.display;
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden){
      document.getElementById("day-consult-panel").style.display = "none";
      renderDayTemplate();
    }
    syncTodayViewsVisibility();
  });

  document.getElementById("new-period-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const name = document.getElementById("np-name").value.trim() || "Nouvelle période";
    const start = document.getElementById("np-start").value || null;
    const end = document.getElementById("np-end").value || null;
    const tpl = { id: nextId(), name, period_start: start, period_end: end, blocks: [] };
    state.dayTemplates.push(tpl);
    state.activeDayTemplateId = tpl.id;
    await saveDayTemplates();
    document.getElementById("np-name").value = "";
    document.getElementById("np-start").value = "";
    document.getElementById("np-end").value = "";
    document.getElementById("new-period-form").style.display = "none";
    renderDayTemplate();
  });

  document.getElementById("day-template-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const start = document.getElementById("dt-start").value;
    const end = document.getElementById("dt-end").value;
    const label = document.getElementById("dt-label").value.trim();
    if (!start || !end || !label) return;

    const overlapping = findOverlappingBlock(start, end, editingDayTemplateBlockId);
    if (overlapping){
      showToast(`Ce créneau chevauche "${overlapping.label}" (${overlapping.start}–${overlapping.end}).`, "error");
      return;
    }

    if (editingDayTemplateBlockId){
      const block = getActiveTemplate().blocks.find(b=>b.id===editingDayTemplateBlockId);
      if (block){ block.start = start; block.end = end; block.label = label; }
      cancelDayTemplateEdit();
    } else {
      getActiveTemplate().blocks.push({ id: nextId(), start, end, label });
      // Auto-chaînage : la fin du bloc qu'on vient d'ajouter devient le début
      // proposé pour le prochain, pour ne pas ressaisir l'heure à chaque fois.
      document.getElementById("dt-start").value = end;
      document.getElementById("dt-end").value = "";
      document.getElementById("dt-label").value = "";
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
    template.blocks.forEach(b=>{
      items.push({ start: b.start, end: b.end, label: b.label, kind: "template", status: null });
    });

    // Routines avec horaire, dont le jour de semaine correspond et dont
    // l'objectif est actif à cette date.
    state.routines.filter(r=>r.day_of_week === dow && r.start_time && r.end_time).forEach(r=>{
      const obj = state.objectives.find(o=>o.id===r.objective_id);
      if (obj){
        if (obj.start_date && dateStr < obj.start_date) return;
        if (obj.target_date && dateStr > obj.target_date) return;
      }
      const log = state.dailyLogs.find(l=>l.routine_id===r.id && l.log_date===dateStr);
      items.push({ start: r.start_time.slice(0,5), end: r.end_time.slice(0,5), label: r.label, kind: "routine", status: log ? log.status : null, hours: log ? log.actual_hours : null, planned: r.planned_hours });
    });

    // Tâches d'agenda avec créneau, dont la plage de dates couvre ce jour.
    state.agendaTasks.filter(t=> dateStr >= t.start_date && dateStr <= t.end_date && t.planning_start && t.planning_end).forEach(t=>{
      const log = state.dailyLogs.find(l=>l.agenda_task_id===t.id && l.log_date===dateStr);
      items.push({ start: t.planning_start.slice(0,5), end: t.planning_end.slice(0,5), label: t.label, kind: "agenda", status: log ? log.status : null, hours: log ? log.actual_hours : null, planned: t.planned_hours });
    });

    // Tâches sans horaire précis (agenda libre) : listées à part, en bas.
    const untimed = state.agendaTasks.filter(t=> dateStr >= t.start_date && dateStr <= t.end_date && !(t.planning_start && t.planning_end));

    items.sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));

    const rowsHtml = items.map(it=>{
      const statusKey = it.status || "none";
      const cat = it.kind === "template" ? it.label : (it.kind === "routine" ? categoryOfObjective(state.routines.find(r=>r.label===it.label)?.objective_id) : it.label);
      const swatchColor = it.kind === "template" ? categoryColor(it.label) : "var(--violet)";
      const hoursText = it.hours !== null && it.hours !== undefined ? ` · ${it.hours}h/${it.planned}h` : "";
      return `
        <div class="dc-item">
          <span class="dc-swatch" style="background:${swatchColor};"></span>
          <span class="dc-time">${it.start}–${it.end}</span>
          <span class="dc-label">${escapeHtml(it.label)}${it.kind !== "template" ? hoursText : ""}</span>
          ${it.kind !== "template" ? `<span class="dc-status ${statusKey}">${statusLabel(it.status)}</span>` : `<span class="dc-status none">structure</span>`}
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

    const ringHtml = renderDayConsultRing(items, dateStr);

    result.innerHTML = `
      <p class="label">Journée type appliquée : ${escapeHtml(template.name)}</p>
      ${ringHtml}
      ${rowsHtml || '<p class="muted" style="font-size:13px;">Rien de programmé à horaire fixe ce jour-là.</p>'}
      ${untimedHtml}
    `;
  }

  // Anneau miroir de celui de "Journée type" : les blocs de structure
  // apparaissent en fond (plus discret), et les routines/tâches d'agenda
  // se superposent, colorées par leur statut réel ce jour-là (vert/orange
  // /rouge) si un check-in existe, sinon par leur catégorie.
  function renderDayConsultRing(items, dateStr){
    if (items.length === 0) return "";
    const size = 220, cx = 110, cy = 110, r = 74, sw = 17;
    const C = 2 * Math.PI * r;

    const segments = [];
    items.forEach(it=>{
      const startMin = timeToMinutes(it.start);
      const endMin = timeToMinutes(it.end);
      if (endMin > startMin){
        segments.push({ it, startMin, lenMin: endMin - startMin });
      } else {
        segments.push({ it, startMin, lenMin: 1440 - startMin });
        segments.push({ it, startMin: 0, lenMin: endMin });
      }
    });

    const colorFor = (it)=>{
      if (it.kind === "template") return categoryColor(it.label);
      if (it.status === "done") return "var(--green)";
      if (it.status === "partial") return "var(--orange)";
      if (it.status === "not_done") return "var(--red)";
      return categoryColor(it.label);
    };

    const segmentsHtml = segments.map(seg=>{
      const startFrac = seg.startMin/1440;
      const arcLen = (seg.lenMin/1440)*C;
      const dashoffset = C*(1-startFrac);
      const opacity = seg.it.kind === "template" ? 0.35 : 1;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colorFor(seg.it)}" stroke-width="${sw}" opacity="${opacity}"
        stroke-dasharray="${arcLen} ${C-arcLen}" stroke-dashoffset="${dashoffset}"
        transform="rotate(-90 ${cx} ${cy})">
        <title>${escapeHtml(seg.it.label)} (${seg.it.start} à ${seg.it.end})</title>
      </circle>`;
    }).join("");

    const dayLabel = new Date(dateStr+"T00:00:00").toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" });

    return `
      <div style="display:flex; justify-content:center; margin:12px 0;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--empty)" stroke-width="${sw}" />
          ${segmentsHtml}
          <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="15" font-family="'IBM Plex Mono',monospace" fill="var(--ink)">${dayLabel}</text>
          <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="10" fill="var(--muted)">fond = structure, couleur = statut réel</text>
        </svg>
      </div>
    `;
  }

  document.getElementById("day-consult-toggle").addEventListener("click", ()=>{
    const panel = document.getElementById("day-consult-panel");
    const isHidden = panel.style.display === "none" || !panel.style.display;
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden){
      document.getElementById("day-template-panel").style.display = "none";
      const dateInput = document.getElementById("day-consult-date");
      if (!dateInput.value) dateInput.value = todayISO();
      renderDayConsult(dateInput.value);
    }
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
    const todaysAgendaTasks = state.agendaTasks.filter(t=> date >= t.start_date && date <= t.end_date).map(t=>({
      key: "agenda-"+t.id, label: t.label, planned_hours: t.planned_hours,
      objective_id: t.objective_id || null, routine_id: null, agenda_task_id: t.id,
      is_priority: t.is_priority,
    }));

    const items = [...todaysRoutines, ...todaysAgendaTasks];
    renderCheckinSummary(items, date);

    const list = document.getElementById("checkin-list");
    list.innerHTML = "";

    if (items.length === 0){
      list.innerHTML = emptyStateHtml("Aucune tâche pour aujourd'hui. Ajoutez une routine dans « Target » ou une tâche dans « Agenda ».");
      return;
    }

    items.forEach(item=>{
      const existing = state.dailyLogs.find(l=> l.log_date===date && (
        item.routine_id ? l.routine_id===item.routine_id : l.agenda_task_id===item.agenda_task_id
      ));
      const cat = item.objective_id ? categoryOfObjective(item.objective_id) : "Agenda";
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "12px";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:14px;">${escapeHtml(item.label)}<span class="cat-badge" style="background:${categoryColor(cat)};">${escapeHtml(cat)}</span>${item.is_priority ? '<span class="priority-badge">Prioritaire</span>' : ""}</strong>
          <span class="mono muted" style="font-size:12px;">${item.planned_hours}h prévues</span>
        </div>
        <div class="status-row">
          <button class="status-btn" data-status="done">Fait</button>
          <button class="status-btn" data-status="partial">Partiel</button>
          <button class="status-btn" data-status="not_done">Non fait</button>
        </div>
        <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
          <label class="muted" style="font-size:12px;">Heures réalisées</label>
          <input type="number" min="0" step="0.25" class="actual-hours mono" style="width:80px;" value="${existing ? existing.actual_hours : item.planned_hours}" />
          <span class="muted" style="font-size:12px;">/ ${item.planned_hours}h</span>
        </div>
        <div style="margin-top:8px;">
          <label class="muted" style="font-size:12px;">Exception</label>
          <select class="excuse-select" style="width:auto; margin-left:6px;">
            <option value="">Aucune (jour normal)</option>
            <option value="malade">Malade</option>
            <option value="conges_payes">Congés payés</option>
          </select>
        </div>
        <button class="btn savebtn">Enregistrer</button>
      `;
      card.querySelector(".excuse-select").value = existing && existing.excused_reason ? existing.excused_reason : "";
      let currentStatus = existing ? existing.status : "done";
      card.querySelectorAll(".status-btn").forEach(b=>{
        if (b.dataset.status === currentStatus) b.classList.add("active");
        b.addEventListener("click", ()=>{
          card.querySelectorAll(".status-btn").forEach(x=>x.classList.remove("active"));
          b.classList.add("active");
          currentStatus = b.dataset.status;
        });
      });
      const saveBtn = card.querySelector(".savebtn");
      saveBtn.addEventListener("click", async ()=>{
        const actual = parseFloat(card.querySelector(".actual-hours").value) || 0;
        const excusedReason = card.querySelector(".excuse-select").value || null;
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
            const saved = await db.upsertDailyLog(state.userId, draft);
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
    document.getElementById("reminder-webhook").value = state.reminder.webhookUrl || "";
    document.getElementById("reminder-channel").value = state.reminder.channel || "email";
    document.getElementById("reminder-phone").value = state.reminder.phone || "";
    document.getElementById("reminder-timezone").value = state.reminder.timezone || "Europe/Paris";
    renderWeeklyLimits();
  }

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
    const webhookUrl = document.getElementById("reminder-webhook").value.trim();
    const channel = document.getElementById("reminder-channel").value || "email";
    const phone = document.getElementById("reminder-phone").value.trim();
    const timezone = document.getElementById("reminder-timezone").value;

    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)){
      msg.textContent = "Le numéro doit être au format international, ex : +33612345678.";
      msg.classList.add("error");
      return;
    }

    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)){
      msg.textContent = "Le webhook Make.com doit être une URL commençant par https://.";
      msg.classList.add("error");
      return;
    }

    if (channel === "sms" && !phone){
      msg.textContent = "Renseignez un numéro de téléphone pour envoyer le rappel par SMS.";
      msg.classList.add("error");
      return;
    }

    if (enabled && "Notification" in window && Notification.permission !== "granted"){
      const permission = await Notification.requestPermission();
      if (permission !== "granted"){
        msg.textContent = "Notifications refusées par le navigateur. Le rappel ne pourra pas s'afficher.";
        msg.classList.add("error");
      }
    }

    state.reminder.enabled = enabled;
    state.reminder.time = time;
    state.reminder.phone = phone;
    state.reminder.timezone = timezone;
    state.reminder.webhookUrl = webhookUrl;
    state.reminder.channel = channel;
    reminderFiredForToday = null;

    if (SUPABASE_CONFIGURED){
      try {
        await db.upsertProfile(state.userId, {
          reminder_enabled: enabled, reminder_time: time, phone: phone || null, timezone,
          reminder_webhook_url: webhookUrl || null, reminder_channel: channel,
        });
      }
      catch(err){ msg.textContent = "Erreur : " + err.message; msg.classList.add("error"); return; }
    }

    if (!msg.textContent){
      msg.textContent = webhookUrl ? `Rappel enregistré (navigateur + Make.com, canal ${channel === "sms" ? "SMS" : "mail"}).` : "Rappel enregistré (navigateur).";
      msg.classList.add("success");
    }
  });

  // =========================================================
  // LIMITES HEBDOMADAIRES PAR CATÉGORIE
  // =========================================================
  function knownCategories(){
    const cats = new Set(Object.keys(state.weeklyLimits));
    state.objectives.forEach(o=> cats.add(o.category || "Autre"));
    if (state.agendaTasks.some(t=>!t.objective_id) || state.dailyLogs.some(l=>l.agenda_task_id && !l.objective_id)){
      cats.add("Agenda");
    }
    return Array.from(cats);
  }

  function hoursUsedThisWeekByCategory(category){
    const currentWeek = logsInDateWindow(0, 6);
    return currentWeek
      .filter(l=> categoryForLog(l) === category)
      .reduce((sum,l)=> sum + l.actual_hours, 0);
  }

  function renderWeeklyLimits(){
    const wrap = document.getElementById("weekly-limits-list");
    const categories = knownCategories();

    if (categories.length === 0){
      wrap.innerHTML = '<p class="muted" style="font-size:13px;">Créez un objectif avec une catégorie pour définir une limite.</p>';
      return;
    }

    wrap.innerHTML = categories.map(cat=>{
      const max = state.weeklyLimits[cat] || 0;
      const used = hoursUsedThisWeekByCategory(cat);
      const pct = max > 0 ? Math.min((used/max)*100, 100) : 0;
      const ratio = max > 0 ? used/max : 0;
      const barColor = ratio >= 1 ? "linear-gradient(90deg, #C4453A, #E2685C)"
        : ratio >= 0.8 ? "linear-gradient(90deg, #B9822C, #E0A83E)"
        : "linear-gradient(90deg, #3C8C5C, #4CAF6D)";

      let alertHtml = "";
      if (max > 0 && ratio >= 1.3){
        alertHtml = `<p class="limit-alert">Limite largement dépassée (${used.toFixed(1)}h / ${max}h). Risque de surmenage, pense à lever le pied.</p>`;
      } else if (max > 0 && ratio >= 1){
        alertHtml = `<p class="limit-alert">Limite dépassée cette semaine (${used.toFixed(1)}h / ${max}h).</p>`;
      }

      return `
        <div class="limit-row">
          <div class="limit-row-head">
            <span class="cat-name"><span class="cat-dot-lg" style="background:${categoryColor(cat)};"></span>${escapeHtml(cat)}</span>
            <span class="limit-input-inline">
              max <input type="number" min="0" step="1" class="limit-max-input" data-category="${escapeHtml(cat)}" value="${max}" /> h/sem
            </span>
          </div>
          <div class="limit-gauge-track"><div class="limit-gauge-fill" style="width:${pct}%; background:${barColor};"></div></div>
          <p class="limit-used-text">${used.toFixed(1)}h utilisées cette semaine${max > 0 ? ` sur ${max}h` : " (aucune limite définie)"}</p>
          ${alertHtml}
        </div>
      `;
    }).join("");
  }

  document.getElementById("limits-save").addEventListener("click", async ()=>{
    const msg = document.getElementById("limits-message");
    msg.classList.remove("error", "success");

    const newLimits = {};
    document.querySelectorAll(".limit-max-input").forEach(input=>{
      const cat = input.dataset.category;
      const val = parseFloat(input.value) || 0;
      if (val > 0) newLimits[cat] = val;
    });
    state.weeklyLimits = newLimits;

    if (SUPABASE_CONFIGURED){
      try { await db.upsertProfile(state.userId, { weekly_limits: newLimits }); }
      catch(err){ msg.textContent = "Erreur : " + err.message; msg.classList.add("error"); return; }
    }

    msg.textContent = "Limites enregistrées.";
    msg.classList.add("success");
    renderWeeklyLimits();
  });

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
  let authMode = "signin"; // "signin" | "signup"

  document.querySelectorAll("#auth-tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      authMode = btn.dataset.authMode;
      document.querySelectorAll("#auth-tabs button").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("auth-submit").textContent = authMode === "signin" ? "Se connecter" : "Créer un compte";
      document.getElementById("auth-message").textContent = "";
      const isSignup = authMode === "signup";
      document.querySelectorAll(".auth-signup-only").forEach(el=>{
        el.style.display = isSignup ? "block" : "none";
        el.required = isSignup;
      });
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
        state.reminder.phone = loaded.profile.phone || "";
        state.reminder.timezone = loaded.profile.timezone || "Europe/Paris";
        state.reminder.webhookUrl = loaded.profile.reminder_webhook_url || "";
        state.reminder.channel = loaded.profile.reminder_channel || "email";
        state.weeklyLimits = loaded.profile.weekly_limits || {};
        const loadedTemplates = loaded.profile.day_template;
        state.dayTemplates = (Array.isArray(loadedTemplates) && loadedTemplates.length > 0 && loadedTemplates[0].blocks)
          ? loadedTemplates
          : [{ id: "tpl-default", name: "Par défaut", period_start: null, period_end: null, blocks: [] }];
        state.activeDayTemplateId = state.dayTemplates[0].id;
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
