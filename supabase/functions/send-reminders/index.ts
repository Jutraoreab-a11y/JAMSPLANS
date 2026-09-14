// =========================================================
// send-reminders — Edge Function (Deno)
// =========================================================
// Déclenchée toutes les minutes par pg_cron (voir supabase/schema.sql,
// section CRON EN BAS DE FICHIER). Pour chaque profil ayant activé son
// rappel, si l'heure locale correspond à l'heure choisie ET qu'il reste
// des tâches non cochées aujourd'hui, envoie un SMS via Twilio.
//
// Secrets requis (à définir avec `supabase secrets set`) :
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER   (numéro Twilio au format E.164, ex: +33757000000)
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement
// par l'environnement des Edge Functions, pas besoin de les définir.
// =========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------
// Heure/date locale d'un profil, à partir de son fuseau horaire
// ---------------------------------------------------------
function localParts(timezone: string) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, // YYYY-MM-DD
    time: `${parts.hour}:${parts.minute}`,               // HH:MM
    dayOfWeek: new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`).getDay(),
  };
}

async function sendSms(to: string, body: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------
// Compte les tâches non cochées d'un utilisateur pour "aujourd'hui"
// (dans son fuseau horaire) : routines actives ce jour de semaine +
// tâches d'agenda dont la plage couvre cette date, moins celles déjà
// pointées "done"/"partial" avec des heures réelles > 0.
// ---------------------------------------------------------
async function countUnfinishedTasks(userId: string, dateStr: string, dayOfWeek: number) {
  const [{ data: objectives }, { data: routines }, { data: agendaTasks }, { data: logs }] = await Promise.all([
    supabase.from("objectives").select("id,start_date,target_date").eq("user_id", userId).eq("is_active", true),
    supabase.from("routines").select("id,objective_id,day_of_week").eq("user_id", userId).eq("is_active", true).eq("day_of_week", dayOfWeek),
    supabase.from("agenda_tasks").select("id").eq("user_id", userId).eq("is_active", true).lte("start_date", dateStr).gte("end_date", dateStr),
    supabase.from("daily_logs").select("routine_id,agenda_task_id,status,actual_hours").eq("user_id", userId).eq("log_date", dateStr),
  ]);

  const objectiveById = new Map((objectives ?? []).map((o: any) => [o.id, o]));
  const activeRoutines = (routines ?? []).filter((r: any) => {
    const obj = objectiveById.get(r.objective_id);
    if (!obj) return true;
    if (obj.start_date && dateStr < obj.start_date) return false;
    if (obj.target_date && dateStr > obj.target_date) return false;
    return true;
  });

  const isDone = (log: any) => log && log.status !== "not_done" && log.actual_hours > 0;
  const logsByRoutine = new Map((logs ?? []).filter((l: any) => l.routine_id).map((l: any) => [l.routine_id, l]));
  const logsByAgenda = new Map((logs ?? []).filter((l: any) => l.agenda_task_id).map((l: any) => [l.agenda_task_id, l]));

  const totalTasks = activeRoutines.length + (agendaTasks ?? []).length;
  const doneCount =
    activeRoutines.filter((r: any) => isDone(logsByRoutine.get(r.id))).length +
    (agendaTasks ?? []).filter((t: any) => isDone(logsByAgenda.get(t.id))).length;

  return totalTasks - doneCount;
}

Deno.serve(async () => {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, reminder_enabled, reminder_time, phone, timezone, last_reminder_sent_date")
    .eq("reminder_enabled", true)
    .not("phone", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;
  const results: Record<string, string> = {};

  for (const profile of profiles ?? []) {
    try {
      const { date, time, dayOfWeek } = localParts(profile.timezone || "Europe/Paris");
      const reminderHHMM = (profile.reminder_time || "20:00").slice(0, 5);

      if (time !== reminderHHMM) continue;                       // pas la bonne minute
      if (profile.last_reminder_sent_date === date) continue;    // déjà envoyé aujourd'hui

      const remaining = await countUnfinishedTasks(profile.id, date, dayOfWeek);
      if (remaining <= 0) { results[profile.id] = "rien à faire, pas d'envoi"; continue; }

      const body = remaining === 1
        ? "JamsPlans : il te reste 1 tâche à valider aujourd'hui."
        : `JamsPlans : il te reste ${remaining} tâches à valider aujourd'hui.`;

      await sendSms(profile.phone, body);
      await supabase.from("profiles").update({ last_reminder_sent_date: date }).eq("id", profile.id);
      sent++;
      results[profile.id] = "SMS envoyé";
    } catch (err) {
      results[profile.id] = `erreur: ${(err as Error).message}`;
    }
  }

  return new Response(JSON.stringify({ checked: (profiles ?? []).length, sent, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
