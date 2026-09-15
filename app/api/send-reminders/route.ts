import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// =========================================================
// /api/send-reminders — appelé chaque minute par le scheduler de server.js
// (voir server.js). Pour chaque profil ayant activé son rappel et
// renseigné un webhook Make.com, si l'heure locale correspond à l'heure
// choisie ET qu'il reste des tâches non cochées aujourd'hui, déclenche ce
// webhook — c'est le scénario Make.com de l'utilisateur qui décide ensuite
// comment envoyer réellement le message (email ou SMS), selon le canal
// choisi dans Profil.
//
// Nécessite SUPABASE_SERVICE_ROLE_KEY (à définir sur Render, jamais
// exposée au navigateur) : la clé publique (anon) ne peut lire, à cause
// des règles RLS, que le profil de l'utilisateur connecté — ce qui ne
// fonctionne pas pour un job planifié sans session.
// =========================================================

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

function localParts(timezone: string) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value])) as Record<string, string>;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    time: `${parts.hour}:${parts.minute}`,
    dayOfWeek: new Date(`${date}T00:00:00`).getDay(),
  };
}

async function countUnfinishedTasks(supabase: any, userId: string, dateStr: string, dayOfWeek: number) {
  const [{ data: objectives }, { data: routines }, { data: agendaTasks }, { data: logs }] = await Promise.all([
    supabase.from('objectives').select('id,start_date,target_date').eq('user_id', userId).eq('is_active', true),
    supabase.from('routines').select('id,objective_id,day_of_week').eq('user_id', userId).eq('is_active', true).eq('day_of_week', dayOfWeek),
    supabase.from('agenda_tasks').select('id').eq('user_id', userId).eq('is_active', true).lte('start_date', dateStr).gte('end_date', dateStr),
    supabase.from('daily_logs').select('routine_id,agenda_task_id,status,actual_hours,excused_reason').eq('user_id', userId).eq('log_date', dateStr),
  ]);

  const objectiveById = new Map<string, any>((objectives ?? []).map((o: any) => [o.id, o]));
  const activeRoutines = (routines ?? []).filter((r: any) => {
    const obj = objectiveById.get(r.objective_id);
    if (!obj) return true;
    if (obj.start_date && dateStr < obj.start_date) return false;
    if (obj.target_date && dateStr > obj.target_date) return false;
    return true;
  });

  const isSettled = (log: any) => log && (log.excused_reason || (log.status !== 'not_done' && log.actual_hours > 0));
  const logsByRoutine = new Map((logs ?? []).filter((l: any) => l.routine_id).map((l: any) => [l.routine_id, l]));
  const logsByAgenda = new Map((logs ?? []).filter((l: any) => l.agenda_task_id).map((l: any) => [l.agenda_task_id, l]));

  const totalTasks = activeRoutines.length + (agendaTasks ?? []).length;
  const doneCount =
    activeRoutines.filter((r: any) => isSettled(logsByRoutine.get(r.id))).length +
    (agendaTasks ?? []).filter((t: any) => isSettled(logsByAgenda.get(t.id))).length;

  return totalTasks - doneCount;
}

export async function GET(_request: Request) {
  try {
    const supabase = getServiceClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY manquante côté serveur : impossible de lire les profils de tous les utilisateurs.' },
        { status: 500 }
      );
    }

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, first_name, reminder_enabled, reminder_time, reminder_webhook_url, reminder_channel, phone, timezone, last_reminder_sent_date')
      .eq('reminder_enabled', true)
      .not('reminder_webhook_url', 'is', null);

    if (error) throw error;

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ message: 'Aucun profil avec un rappel actif et un webhook configuré.' }, { status: 200 });
    }

    let sent = 0;
    const results: Record<string, string> = {};

    for (const profile of profiles) {
      try {
        const { date, time, dayOfWeek } = localParts(profile.timezone || 'Europe/Paris');
        const reminderHHMM = (profile.reminder_time || '20:00').slice(0, 5);

        // On ne sait pas à quelle fréquence cette route est appelée (toutes les
        // 5 minutes via GitHub Actions, voir .github/workflows/send-reminders.yml) :
        // on déclenche donc dès que l'heure locale a atteint (ou dépassé) l'heure
        // choisie, une seule fois par jour grâce au garde-fou last_reminder_sent_date.
        if (time < reminderHHMM) continue;                          // heure pas encore atteinte
        if (profile.last_reminder_sent_date === date) continue;    // déjà envoyé aujourd'hui

        const remaining = await countUnfinishedTasks(supabase, profile.id, date, dayOfWeek);
        if (remaining <= 0) { results[profile.id] = "rien à faire, pas d'envoi"; continue; }

        const message = remaining === 1
          ? 'JamsPlans : il te reste 1 tâche à valider aujourd’hui.'
          : `JamsPlans : il te reste ${remaining} tâches à valider aujourd’hui.`;

        let email: string | null = null;
        try {
          const { data: userRes } = await supabase.auth.admin.getUserById(profile.id);
          email = userRes?.user?.email ?? null;
        } catch (_e) { /* pas bloquant */ }

        await fetch(profile.reminder_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: profile.id,
            firstName: profile.first_name || '',
            email,
            phone: profile.phone || null,
            channel: profile.reminder_channel || 'email',
            remaining,
            message,
            date,
          }),
        });

        await supabase.from('profiles').update({ last_reminder_sent_date: date }).eq('id', profile.id);
        sent++;
        results[profile.id] = 'webhook déclenché';
      } catch (err: any) {
        results[profile.id] = `erreur: ${err.message}`;
      }
    }

    return NextResponse.json({ checked: profiles.length, sent, results });
  } catch (err: any) {
    console.error("Erreur lors de l'envoi des rappels:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
