"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { DailyLog, DAYS_OF_WEEK, NewDailyLog, Routine, TaskStatus } from "@/lib/types";
import { todayISO } from "@/lib/calculations";

interface Props {
  routines: Routine[];
  dailyLogs: DailyLog[];
  upsertDailyLog: (payload: NewDailyLog) => Promise<{ error?: string }>;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { value: "done", label: "Fait", icon: <CheckCircle2 size={16} /> },
  { value: "partial", label: "Partiellement fait", icon: <CircleDashed size={16} /> },
  { value: "not_done", label: "Non fait", icon: <XCircle size={16} /> },
];

export function DailyCheckin({ routines, dailyLogs, upsertDailyLog }: Props) {
  const [date, setDate] = useState(todayISO());
  const dayOfWeek = new Date(date + "T00:00:00").getDay();

  const todaysRoutines = useMemo(
    () => routines.filter((r) => r.day_of_week === dayOfWeek),
    [routines, dayOfWeek]
  );

  const logsByRoutine = useMemo(() => {
    const map = new Map<string, DailyLog>();
    for (const log of dailyLogs) {
      if (log.log_date === date && log.routine_id) map.set(log.routine_id, log);
    }
    return map;
  }, [dailyLogs, date]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl text-ink">Check-in du soir</h2>
          <p className="mt-1 text-sm text-muted">
            {DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.label} — validez la journée en
            quelques secondes.
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-card border border-line bg-white/60 px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </div>

      {todaysRoutines.length === 0 ? (
        <div className="rounded-card border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Aucun créneau prévu ce jour-là. Ajoutez une routine dans l&apos;onglet
          &laquo;&nbsp;Objectifs & Planning&nbsp;&raquo;.
        </div>
      ) : (
        <div className="space-y-4">
          {todaysRoutines.map((routine) => (
            <CheckinCard
              key={routine.id}
              routine={routine}
              date={date}
              existingLog={logsByRoutine.get(routine.id)}
              upsertDailyLog={upsertDailyLog}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckinCard({
  routine,
  date,
  existingLog,
  upsertDailyLog,
}: {
  routine: Routine;
  date: string;
  existingLog?: DailyLog;
  upsertDailyLog: (payload: NewDailyLog) => Promise<{ error?: string }>;
}) {
  const [status, setStatus] = useState<TaskStatus>(existingLog?.status ?? "done");
  const [actualHours, setActualHours] = useState(
    existingLog ? String(existingLog.actual_hours) : String(routine.planned_hours)
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const { error } = await upsertDailyLog({
      routine_id: routine.id,
      objective_id: routine.objective_id,
      log_date: date,
      status,
      planned_hours: routine.planned_hours,
      actual_hours: parseFloat(actualHours) || 0,
      note: null,
    });
    setSaving(false);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  }

  return (
    <div className="rounded-card border border-line bg-white/60 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium text-ink">{routine.label}</p>
        <p className="font-mono text-xs text-muted">{routine.planned_hours}h prévues</p>
      </div>

      {/* 1. Statut */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatus(opt.value)}
            className={[
              "flex flex-col items-center gap-1 rounded-card border px-2 py-2 text-xs transition-colors",
              status === opt.value
                ? "border-ink bg-ink text-paper"
                : "border-line text-muted hover:border-ink hover:text-ink",
            ].join(" ")}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {/* 2. Heures réelles */}
      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-muted">Heures réalisées</label>
        <input
          type="number"
          min={0}
          step={0.25}
          value={actualHours}
          onChange={(e) => setActualHours(e.target.value)}
          className="w-20 rounded-card border border-line bg-paper px-2 py-1.5 font-mono text-sm outline-none focus:border-ink"
        />
        <span className="text-xs text-muted">/ {routine.planned_hours}h</span>
      </div>

      {/* 3. Enregistrement */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={[
          "mt-3 flex w-full items-center justify-center gap-2 rounded-card px-4 py-2 text-sm transition-colors disabled:opacity-60",
          saved ? "bg-status-green text-white" : "bg-ink text-paper hover:opacity-90",
        ].join(" ")}
      >
        {saved ? (
          <>
            <Check size={15} /> Enregistré
          </>
        ) : saving ? (
          "Enregistrement…"
        ) : (
          "Enregistrer"
        )}
      </button>
    </div>
  );
}
