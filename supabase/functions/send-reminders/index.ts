// =========================================================
// send-reminders — Edge Function (Deno)
// =========================================================
// Déclenchée toutes les minutes par pg_cron (voir supabase/schema.sql,
// section CRON EN BAS DE FICHIER). Pour chaque profil ayant activé son
// rappel et renseigné un webhook Make.com, si l'heure locale correspond à
// l'heure choisie ET qu'il reste des tâches non cochées aujourd'hui,
// envoie une requête POST à ce webhook — c'est le scénario Make.com de
// l'utilisateur qui décide ensuite comment envoyer réellement le message
// (email, SMS, WhatsApp...), en fonction du canal choisi dans Profil.
//
// Aucun secret à configurer ici : chaque profil porte sa propre URL de
// webhook (colonne profiles.reminder_webhook_url), branchée par
// l'utilisateur lui-même dans Profil > Rappel du soir.
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement
// par l'environnement des Edge Functions, pas besoin de les définir.
// =========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// ---------------------------------------------------------
// Envoie l'événement au scénario Make.com de l'utilisateur. C'est Make qui
// route ensuite vers Email ou SMS selon le "channel" transmis ici.
// ---------------------------------------------------------
async function triggerMakeWebhook(webhookUrl: string, payload: Record<string, unknown>) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook Make.com error (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------
// Compte les tâches non cochées d'un utilisateur pour "aujourd'hui"
// (dans son fuseau horaire) : routines actives ce jour de semaine +
// tâches d'agenda dont la plage couvre cette date, moins celles déjà
// pointées "done"/"partial" avec des heures réelles > 0, ou marquées en
// exception (malade / congés payés — voir daily_logs.excused_reason).
// ---------------------------------------------------------
async function countUnfinishedTasks(userId: string, dateStr: string, dayOfWeek: number) {
  const [{ data: objectives }, { data: routines }, { data: agendaTasks }, { data: logs }] = await Promise.all([
    supabase.from("objectives").select("id,start_date,target_date").eq("user_id", userId).eq("is_active", true),
    supabase.from("routines").select("id,objective_id,day_of_week").eq("user_id", userId).eq("is_active", true).eq("day_of_week", dayOfWeek),
    supabase.from("agenda_tasks").select("id").eq("user_id", userId).eq("is_active", true).lte("start_date", dateStr).gte("end_date", dateStr),
    supabase.from("daily_logs").select("routine_id,agenda_task_id,status,actual_hours,excused_reason").eq("user_id", userId).eq("log_date", dateStr),
  ]);

  const objectiveById = new Map((objectives ?? []).map((o: any) => [o.id, o]));
  const activeRoutines = (routines ?? []).filter((r: any) => {
    const obj = objectiveById.get(r.objective_id);
    if (!obj) return true;
    if (obj.start_date && dateStr < obj.start_date) return false;
    if (obj.target_date && dateStr > obj.target_date) return false;
    return true;
  });

  const isSettled = (log: any) => log && (log.excused_reason || (log.status !== "not_done" && log.actual_hours > 0));
  const logsByRoutine = new Map((logs ?? []).filter((l: any) => l.routine_id).map((l: any) => [l.routine_id, l]));
  const logsByAgenda = new Map((logs ?? []).filter((l: any) => l.agenda_task_id).map((l: any) => [l.agenda_task_id, l]));

  const totalTasks = activeRoutines.length + (agendaTasks ?? []).length;
  const doneCount =
    activeRoutines.filter((r: any) => isSettled(logsByRoutine.get(r.id))).length +
    (agendaTasks ?? []).filter((t: any) => isSettled(logsByAgenda.get(t.id))).length;

  return totalTasks - doneCount;
}

Deno.serve(async () => {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, first_name, reminder_enabled, reminder_time, reminder_webhook_url, reminder_channel_email, reminder_channel_sms, phone, timezone, last_reminder_sent_date")
    .eq("reminder_enabled", true)
    .not("reminder_webhook_url", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;
  const results: Record<string, string> = {};

  for (const profile of profiles ?? []) {
    try {
      const { date, time, dayOfWeek } = localParts(profile.timezone || "Europe/Paris");
      const reminderHHMM = (profile.reminder_time || "20:00").slice(0, 5);

      // On ne sait pas à quelle fréquence cette fonction est appelée (chaque
      // minute via pg_cron, ou moins souvent) : on déclenche donc dès que
      // l'heure locale a atteint (ou dépassé) l'heure choisie, une seule
      // fois par jour grâce au garde-fou last_reminder_sent_date ci-dessous.
      if (time < reminderHHMM) continue;                          // heure pas encore atteinte
      if (profile.last_reminder_sent_date === date) continue;    // déjà envoyé aujourd'hui

      const remaining = await countUnfinishedTasks(profile.id, date, dayOfWeek);
      if (remaining <= 0) { results[profile.id] = "rien à faire, pas d'envoi"; continue; }

      // Message motivant plutôt qu'un simple constat : on rappelle
      // explicitement d'aller cocher ses objectifs dans la check-liste,
      // avec un ton encourageant plutôt qu'une notification froide.
      const message = remaining === 1
        ? "Il te reste 1 objectif à cocher aujourd'hui. Encore un petit effort : ouvre ta check-liste JamsPlans et boucle-le avant la fin de la journée — tu es plus proche du but que tu ne le crois."
        : `Il te reste ${remaining} objectifs à cocher aujourd'hui. Chaque case cochée compte : ouvre ta check-liste JamsPlans et termine ta journée en beauté.`;

      let email: string | null = null;
      try {
        const { data: userRes } = await supabase.auth.admin.getUserById(profile.id);
        email = userRes?.user?.email ?? null;
      } catch (_e) { /* on envoie quand même le webhook sans email si indisponible */ }

      await triggerMakeWebhook(profile.reminder_webhook_url, {
        userId: profile.id,
        firstName: profile.first_name || "",
        email,
        phone: profile.phone || null,
        channelEmail: profile.reminder_channel_email !== false,
        channelSms: !!profile.reminder_channel_sms,
        remaining,
        message,
        date,
      });

      await supabase.from("profiles").update({ last_reminder_sent_date: date }).eq("id", profile.id);
      sent++;
      results[profile.id] = "webhook déclenché";
    } catch (err) {
      results[profile.id] = `erreur: ${(err as Error).message}`;
    }
  }

  return new Response(JSON.stringify({ checked: (profiles ?? []).length, sent, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
