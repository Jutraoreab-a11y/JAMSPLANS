"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  DailyLog,
  NewDailyLog,
  NewObjective,
  NewRoutine,
  Objective,
  Routine,
} from "./types";

export function useAppData() {
  const [userId, setUserId] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      setError("Utilisateur non authentifié.");
      setLoading(false);
      return;
    }
    setUserId(userData.user.id);

    const [objRes, routRes, logRes] = await Promise.all([
      supabase
        .from("objectives")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("routines")
        .select("*")
        .eq("is_active", true)
        .order("day_of_week", { ascending: true }),
      supabase
        .from("daily_logs")
        .select("*")
        .order("log_date", { ascending: false }),
    ]);

    if (objRes.error) setError(objRes.error.message);
    if (routRes.error) setError(routRes.error.message);
    if (logRes.error) setError(logRes.error.message);

    setObjectives((objRes.data as Objective[]) ?? []);
    setRoutines((routRes.data as Routine[]) ?? []);
    setDailyLogs((logRes.data as DailyLog[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // -------------------- Objectives --------------------
  const addObjective = useCallback(
    async (payload: NewObjective) => {
      if (!userId) return { error: "Non authentifié" };
      const { data, error } = await supabase
        .from("objectives")
        .insert({ ...payload, user_id: userId })
        .select()
        .single();
      if (error) return { error: error.message };
      setObjectives((prev) => [...prev, data as Objective]);
      return { data: data as Objective };
    },
    [userId]
  );

  const deleteObjective = useCallback(async (id: string) => {
    const { error } = await supabase.from("objectives").delete().eq("id", id);
    if (error) return { error: error.message };
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    setRoutines((prev) => prev.filter((r) => r.objective_id !== id));
    return {};
  }, []);

  // -------------------- Routines --------------------
  const addRoutine = useCallback(
    async (payload: NewRoutine) => {
      if (!userId) return { error: "Non authentifié" };
      const { data, error } = await supabase
        .from("routines")
        .insert({ ...payload, user_id: userId })
        .select()
        .single();
      if (error) return { error: error.message };
      setRoutines((prev) => [...prev, data as Routine]);
      return { data: data as Routine };
    },
    [userId]
  );

  const deleteRoutine = useCallback(async (id: string) => {
    const { error } = await supabase.from("routines").delete().eq("id", id);
    if (error) return { error: error.message };
    setRoutines((prev) => prev.filter((r) => r.id !== id));
    return {};
  }, []);

  // -------------------- Daily logs --------------------
  // upsert : un log par (routine_id, log_date) — cf. contrainte unique en base
  const upsertDailyLog = useCallback(
    async (payload: NewDailyLog) => {
      if (!userId) return { error: "Non authentifié" };
      const { data, error } = await supabase
        .from("daily_logs")
        .upsert(
          { ...payload, user_id: userId },
          { onConflict: "user_id,routine_id,log_date" }
        )
        .select()
        .single();
      if (error) return { error: error.message };

      setDailyLogs((prev) => {
        const withoutThis = prev.filter((l) => l.id !== (data as DailyLog).id);
        return [data as DailyLog, ...withoutThis];
      });
      return { data: data as DailyLog };
    },
    [userId]
  );

  return {
    userId,
    objectives,
    routines,
    dailyLogs,
    loading,
    error,
    refresh: fetchAll,
    addObjective,
    deleteObjective,
    addRoutine,
    deleteRoutine,
    upsertDailyLog,
  };
}
