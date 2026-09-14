"use client";

import { useState } from "react";
import { Plus, Trash2, Target } from "lucide-react";
import { DAYS_OF_WEEK, NewObjective, NewRoutine, Objective, Routine } from "@/lib/types";

interface Props {
  objectives: Objective[];
  routines: Routine[];
  addObjective: (payload: NewObjective) => Promise<{ error?: string }>;
  deleteObjective: (id: string) => Promise<{ error?: string }>;
  addRoutine: (payload: NewRoutine) => Promise<{ error?: string }>;
  deleteRoutine: (id: string) => Promise<{ error?: string }>;
}

export function ObjectivesPlanning({
  objectives,
  routines,
  addObjective,
  deleteObjective,
  addRoutine,
  deleteRoutine,
}: Props) {
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("10");
  const [submitting, setSubmitting] = useState(false);

  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string>("");

  async function handleAddObjective(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await addObjective({
      title: title.trim(),
      description: null,
      target_date: targetDate || null,
      weekly_hours_target: parseFloat(weeklyHours) || 0,
    });
    setTitle("");
    setTargetDate("");
    setWeeklyHours("10");
    setSubmitting(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      {/* -------------------- Nouvel objectif -------------------- */}
      <section>
        <h2 className="font-serif text-xl text-ink">Grand objectif</h2>
        <p className="mt-1 text-sm text-muted">
          Le cap que vous visez — vos routines s&apos;y rattacheront.
        </p>

        <form
          onSubmit={handleAddObjective}
          className="mt-4 grid grid-cols-1 gap-3 rounded-card border border-line bg-white/60 p-4 sm:grid-cols-[1fr_auto_auto_auto]"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Valider le DCG"
            className="rounded-card border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="rounded-card border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={0.5}
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
              className="w-20 rounded-card border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
            />
            <span className="text-xs text-muted">h/sem</span>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-1 rounded-card bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={15} /> Ajouter
          </button>
        </form>

        <ul className="mt-4 space-y-2">
          {objectives.map((obj) => (
            <li
              key={obj.id}
              className="flex items-center justify-between rounded-card border border-line bg-white/60 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Target size={16} className="text-muted" />
                <div>
                  <p className="text-sm font-medium text-ink">{obj.title}</p>
                  <p className="text-xs text-muted">
                    {obj.weekly_hours_target}h / semaine
                    {obj.target_date ? ` · échéance ${obj.target_date}` : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => deleteObjective(obj.id)}
                className="text-muted transition-colors hover:text-status-red"
                aria-label="Supprimer l'objectif"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
          {objectives.length === 0 && (
            <li className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              Aucun objectif pour l&apos;instant. Ajoutez-en un ci-dessus.
            </li>
          )}
        </ul>
      </section>

      {/* -------------------- Routines hebdomadaires -------------------- */}
      <section>
        <h2 className="font-serif text-xl text-ink">Routine hebdomadaire</h2>
        <p className="mt-1 text-sm text-muted">
          Associez un créneau par jour à l&apos;un de vos objectifs.
        </p>

        {objectives.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            Créez d&apos;abord un objectif pour pouvoir y rattacher des créneaux.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {objectives.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => setSelectedObjectiveId(obj.id)}
                  className={[
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    selectedObjectiveId === obj.id
                      ? "border-ink bg-ink text-paper"
                      : "border-line text-muted hover:border-ink hover:text-ink",
                  ].join(" ")}
                >
                  {obj.title}
                </button>
              ))}
            </div>

            {selectedObjectiveId && (
              <RoutineDayGrid
                objectiveId={selectedObjectiveId}
                routines={routines.filter((r) => r.objective_id === selectedObjectiveId)}
                addRoutine={addRoutine}
                deleteRoutine={deleteRoutine}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function RoutineDayGrid({
  objectiveId,
  routines,
  addRoutine,
  deleteRoutine,
}: {
  objectiveId: string;
  routines: Routine[];
  addRoutine: (payload: NewRoutine) => Promise<{ error?: string }>;
  deleteRoutine: (id: string) => Promise<{ error?: string }>;
}) {
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState("2");
  const [day, setDay] = useState(1);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    await addRoutine({
      objective_id: objectiveId,
      day_of_week: day,
      label: label.trim(),
      planned_hours: parseFloat(hours) || 0,
      start_time: null,
    });
    setLabel("");
    setHours("2");
  }

  return (
    <div className="mt-4">
      <form
        onSubmit={handleAdd}
        className="grid grid-cols-2 gap-2 rounded-card border border-line bg-white/60 p-4 sm:grid-cols-[auto_1fr_auto_auto]"
      >
        <select
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          className="rounded-card border border-line bg-paper px-2 py-2 text-sm outline-none focus:border-ink"
        >
          {DAYS_OF_WEEK.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ex : Comptabilité"
          className="rounded-card border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-16 rounded-card border border-line bg-paper px-2 py-2 text-sm outline-none focus:border-ink"
          />
          <span className="text-xs text-muted">h</span>
        </div>
        <button
          type="submit"
          className="flex items-center justify-center gap-1 rounded-card bg-ink px-3 py-2 text-sm text-paper hover:opacity-90"
        >
          <Plus size={15} />
        </button>
      </form>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DAYS_OF_WEEK.map((d) => {
          const dayRoutines = routines.filter((r) => r.day_of_week === d.value);
          if (dayRoutines.length === 0) return null;
          return (
            <div key={d.value} className="rounded-card border border-line bg-white/60 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                {d.label}
              </p>
              <ul className="space-y-1.5">
                {dayRoutines.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink">
                      {r.label} <span className="text-muted">· {r.planned_hours}h</span>
                    </span>
                    <button
                      onClick={() => deleteRoutine(r.id)}
                      className="text-muted hover:text-status-red"
                      aria-label="Supprimer le créneau"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
