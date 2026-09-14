// =========================================================
// Types partagés — reflètent le schéma Supabase (schema.sql)
// =========================================================

export type TaskStatus = "done" | "partial" | "not_done";

export type ColorCode = "green" | "orange" | "red" | "empty";

export interface Objective {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  target_date: string | null; // ISO date
  weekly_hours_target: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Routine {
  id: string;
  user_id: string;
  objective_id: string;
  day_of_week: number; // 0 (dimanche) .. 6 (samedi)
  label: string;
  planned_hours: number;
  start_time: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailyLog {
  id: string;
  user_id: string;
  routine_id: string | null;
  objective_id: string;
  log_date: string; // ISO date (yyyy-mm-dd)
  status: TaskStatus;
  planned_hours: number;
  actual_hours: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// Formes utilisées pour la création (avant insertion en base)
export type NewObjective = Pick<
  Objective,
  "title" | "description" | "target_date" | "weekly_hours_target"
>;

export type NewRoutine = Pick<
  Routine,
  "objective_id" | "day_of_week" | "label" | "planned_hours" | "start_time"
>;

export type NewDailyLog = Pick<
  DailyLog,
  | "routine_id"
  | "objective_id"
  | "log_date"
  | "status"
  | "planned_hours"
  | "actual_hours"
  | "note"
>;

export const DAYS_OF_WEEK: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Lundi", short: "Lun" },
  { value: 2, label: "Mardi", short: "Mar" },
  { value: 3, label: "Mercredi", short: "Mer" },
  { value: 4, label: "Jeudi", short: "Jeu" },
  { value: 5, label: "Vendredi", short: "Ven" },
  { value: 6, label: "Samedi", short: "Sam" },
  { value: 0, label: "Dimanche", short: "Dim" },
];
