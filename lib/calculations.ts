import { ColorCode, DailyLog } from "./types";

// =========================================================
// Détermination de la couleur d'un jour à partir de son log
// =========================================================
// 🟢 vert   : tâche faite ET heures réalisées >= heures prévues
// 🟠 orange : tâche faite ou partielle, mais heures < prévues
// 🔴 rouge  : non faite, ou aucune heure réalisée
// (aucun log pour un jour qui a une routine prévue = rouge aussi,
//  géré au niveau de l'appelant via buildCalendarDay)
export function getColorCode(log: Pick<DailyLog, "status" | "planned_hours" | "actual_hours">): ColorCode {
  const { status, planned_hours, actual_hours } = log;

  if (status === "not_done" || actual_hours <= 0) return "red";

  if (status === "done" && planned_hours > 0 && actual_hours >= planned_hours) {
    return "green";
  }

  // Cas: planned_hours = 0 (pas de créneau prévu) mais du travail a été fait
  if (planned_hours === 0 && actual_hours > 0) return "green";

  return "orange";
}

export const COLOR_STYLES: Record<
  ColorCode,
  { bg: string; ring: string; label: string }
> = {
  green: { bg: "bg-[#2F5233]", ring: "ring-[#2F5233]/30", label: "Objectif atteint" },
  orange: { bg: "bg-[#C98A2B]", ring: "ring-[#C98A2B]/30", label: "Partiel" },
  red: { bg: "bg-[#B33A2E]", ring: "ring-[#B33A2E]/30", label: "Non réalisé" },
  empty: { bg: "bg-[#E4E1D8]", ring: "ring-transparent", label: "Pas de donnée" },
};

// =========================================================
// Score de Discipline (%) = (jours verts / jours avec log) * 100
// =========================================================
export function computeDisciplineScore(logs: DailyLog[]): number {
  if (logs.length === 0) return 0;
  const greenDays = logs.filter((l) => getColorCode(l) === "green").length;
  return Math.round((greenDays / logs.length) * 1000) / 10;
}

// =========================================================
// Score de Performance (%) = (somme heures réelles / somme heures prévues) * 100
// =========================================================
export function computePerformanceScore(logs: DailyLog[]): number {
  const totalPlanned = logs.reduce((sum, l) => sum + l.planned_hours, 0);
  const totalActual = logs.reduce((sum, l) => sum + l.actual_hours, 0);
  if (totalPlanned === 0) return 0;
  return Math.round((totalActual / totalPlanned) * 1000) / 10;
}

// =========================================================
// Ratio d'heures (jauge) : heures réalisées / heures attendues
// =========================================================
export function computeHoursRatio(logs: DailyLog[]) {
  const planned = logs.reduce((sum, l) => sum + l.planned_hours, 0);
  const actual = logs.reduce((sum, l) => sum + l.actual_hours, 0);
  const ratio = planned > 0 ? Math.min(actual / planned, 1.5) : 0; // cap visuel à 150%
  return { planned, actual, ratio };
}

// =========================================================
// Streak (série de jours verts consécutifs, en partant d'aujourd'hui
// ou du jour le plus récent en arrière)
// =========================================================
export function computeStreak(logs: DailyLog[]): number {
  if (logs.length === 0) return 0;

  const sorted = [...logs].sort(
    (a, b) => new Date(b.log_date).getTime() - new Date(a.log_date).getTime()
  );

  let streak = 0;
  let cursor: Date | null = null;

  for (const log of sorted) {
    const logDate = new Date(log.log_date + "T00:00:00");

    if (cursor === null) {
      // premier jour : doit être vert pour démarrer la série
      if (getColorCode(log) !== "green") break;
      streak = 1;
      cursor = logDate;
      continue;
    }

    const expectedPrevDay = new Date(cursor);
    expectedPrevDay.setDate(expectedPrevDay.getDate() - 1);

    const sameDay = logDate.getTime() === expectedPrevDay.getTime();
    if (!sameDay) break; // trou dans la série -> on arrête
    if (getColorCode(log) !== "green") break;

    streak += 1;
    cursor = logDate;
  }

  return streak;
}

// =========================================================
// Helpers de formatage
// =========================================================
export function formatHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

export function formatPercent(p: number): string {
  return `${p.toFixed(1)}%`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
