"use client";

import { useState } from "react";
import { TabKey, TabNav } from "@/components/TabNav";
import { ObjectivesPlanning } from "@/components/ObjectivesPlanning";
import { DailyCheckin } from "@/components/DailyCheckin";
import { Dashboard } from "@/components/Dashboard";
import { useAppData } from "@/lib/useAppData";

export default function Home() {
  const [tab, setTab] = useState<TabKey>("checkin");
  const {
    objectives,
    routines,
    dailyLogs,
    loading,
    error,
    addObjective,
    deleteObjective,
    addRoutine,
    deleteRoutine,
    upsertDailyLog,
  } = useAppData();

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-5">
          <h1 className="font-serif text-2xl text-ink">Carnet de Discipline</h1>
          <p className="text-sm text-muted">Objectifs, routines et régularité au quotidien.</p>
        </div>
      </header>

      <TabNav active={tab} onChange={setTab} />

      {error && (
        <div className="mx-auto mt-4 max-w-3xl rounded-card border border-status-red bg-status-redSoft px-4 py-3 text-sm text-status-red">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted">
          Chargement…
        </div>
      ) : (
        <>
          {tab === "planning" && (
            <ObjectivesPlanning
              objectives={objectives}
              routines={routines}
              addObjective={addObjective}
              deleteObjective={deleteObjective}
              addRoutine={addRoutine}
              deleteRoutine={deleteRoutine}
            />
          )}
          {tab === "checkin" && (
            <DailyCheckin
              routines={routines}
              dailyLogs={dailyLogs}
              upsertDailyLog={upsertDailyLog}
            />
          )}
          {tab === "dashboard" && (
            <Dashboard objectives={objectives} dailyLogs={dailyLogs} />
          )}
        </>
      )}
    </main>
  );
}
