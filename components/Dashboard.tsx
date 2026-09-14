"use client";

import { useMemo, useState } from "react";
import { Flame } from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import { DailyLog, Objective } from "@/lib/types";
import {
  COLOR_STYLES,
  computeDisciplineScore,
  computeHoursRatio,
  computePerformanceScore,
  computeStreak,
  formatHours,
  formatPercent,
  getColorCode,
} from "@/lib/calculations";

interface Props {
  objectives: Objective[];
  dailyLogs: DailyLog[];
}

type Range = "week" | "month";

export function Dashboard({ objectives, dailyLogs }: Props) {
  const [range, setRange] = useState<Range>("week");
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string>("all");

  const filteredLogs = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (range === "week" ? 7 : 30));

    return dailyLogs.filter((log) => {
      const matchesObjective =
        selectedObjectiveId === "all" || log.objective_id === selectedObjectiveId;
      const matchesRange = new Date(log.log_date + "T00:00:00") >= cutoff;
      return matchesObjective && matchesRange;
    });
  }, [dailyLogs, range, selectedObjectiveId]);

  const streakLogs = useMemo(
    () =>
      dailyLogs.filter(
        (l) => selectedObjectiveId === "all" || l.objective_id === selectedObjectiveId
      ),
    [dailyLogs, selectedObjectiveId]
  );

  const discipline = computeDisciplineScore(filteredLogs);
  const performance = computePerformanceScore(filteredLogs);
  const { planned, actual, ratio } = computeHoursRatio(filteredLogs);
  const streak = computeStreak(streakLogs);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      {/* -------------------- Filtres -------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["week", "month"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                "rounded-full border px-3 py-1 text-xs transition-colors",
                range === r
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-muted hover:border-ink hover:text-ink",
              ].join(" ")}
            >
              {r === "week" ? "7 derniers jours" : "30 derniers jours"}
            </button>
          ))}
        </div>
        <select
          value={selectedObjectiveId}
          onChange={(e) => setSelectedObjectiveId(e.target.value)}
          className="rounded-card border border-line bg-white/60 px-3 py-1.5 text-xs outline-none focus:border-ink"
        >
          <option value="all">Tous les objectifs</option>
          {objectives.map((obj) => (
            <option key={obj.id} value={obj.id}>
              {obj.title}
            </option>
          ))}
        </select>
      </div>

      {/* -------------------- KPIs -------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Discipline" value={formatPercent(discipline)} accent="green" />
        <KpiCard label="Performance" value={formatPercent(performance)} accent="orange" />
        <KpiCard
          label="Heures"
          value={`${formatHours(actual)} / ${formatHours(planned)}`}
          accent="ink"
        />
        <KpiCard
          label="Série en cours"
          value={`${streak} j`}
          accent="ink"
          icon={streak > 0 ? <Flame size={14} className="text-status-orange" /> : undefined}
        />
      </div>

      {/* -------------------- Jauge d'heures -------------------- */}
      <section className="rounded-card border border-line bg-white/60 p-4">
        <h3 className="font-serif text-base text-ink">Jauge d&apos;heures</h3>
        <p className="text-xs text-muted">
          Heures réalisées vs. heures attendues ({range === "week" ? "semaine" : "mois"})
        </p>
        <div className="mx-auto mt-2 h-48 w-48">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="70%"
              outerRadius="100%"
              data={[{ name: "ratio", value: Math.min(ratio * 100, 150) }]}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 150]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} fill="#2F5233" background={{ fill: "#E4E1D8" }} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <p className="-mt-32 text-center font-mono text-2xl text-ink">
          {formatPercent(ratio * 100)}
        </p>
      </section>

      {/* -------------------- Calendrier coloré -------------------- */}
      <section>
        <h3 className="font-serif text-base text-ink">Calendrier</h3>
        <p className="mb-3 text-xs text-muted">
          🟢 objectif atteint · 🟠 partiel · 🔴 non réalisé
        </p>
        <CalendarGrid logs={filteredLogs} />
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: "green" | "orange" | "ink";
  icon?: React.ReactNode;
}) {
  const accentClass =
    accent === "green"
      ? "text-status-green"
      : accent === "orange"
      ? "text-status-orange"
      : "text-ink";
  return (
    <div className="rounded-card border border-line bg-white/60 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 flex items-center gap-1 font-mono text-xl ${accentClass}`}>
        {icon}
        {value}
      </p>
    </div>
  );
}

function CalendarGrid({ logs }: { logs: DailyLog[] }) {
  // Regroupe les logs par jour (un jour peut avoir plusieurs routines /
  // couleur la plus défavorable retenue pour la case)
  const byDate = useMemo(() => {
    const map = new Map<string, DailyLog[]>();
    for (const log of logs) {
      const arr = map.get(log.log_date) ?? [];
      arr.push(log);
      map.set(log.log_date, arr);
    }
    return map;
  }, [logs]);

  const sortedDates = Array.from(byDate.keys()).sort();

  if (sortedDates.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        Aucune donnée pour cette période.
      </div>
    );
  }

  const priority = { red: 0, orange: 1, green: 2, empty: 3 };

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {sortedDates.map((date) => {
        const dayLogs = byDate.get(date)!;
        const worstColor = dayLogs
          .map((l) => getColorCode(l))
          .sort((a, b) => priority[a] - priority[b])[0];
        const style = COLOR_STYLES[worstColor];
        const dayNum = new Date(date + "T00:00:00").getDate();

        return (
          <div
            key={date}
            title={`${date} — ${style.label}`}
            className={`flex aspect-square items-center justify-center rounded-card ${style.bg} font-mono text-xs text-white/90`}
          >
            {dayNum}
          </div>
        );
      })}
    </div>
  );
}
