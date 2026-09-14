-- =========================================================
-- SCHEMA SUPABASE — Tracker de Discipline & Objectifs
-- =========================================================
-- À exécuter dans l'éditeur SQL de Supabase (Project > SQL Editor)
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- TABLE: objectives
-- Les grands objectifs de l'utilisateur (ex: "Valider le DCG")
-- ---------------------------------------------------------
create table if not exists public.objectives (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'Autre',              -- Travail / Sport / Étude / Langue / Autre (libre)
  start_date date,                                      -- début de la fenêtre de planification
  target_date date,                                     -- échéance / fin de la fenêtre
  weekly_hours_target numeric(5,2) not null default 0, -- volume cible hebdo (heures)
  is_active boolean not null default true,
  achieved boolean not null default false,             -- objectif marqué "atteint"
  current_year integer not null default extract(year from now())::int, -- cycle en cours (N, N+1, ...)
  history jsonb not null default '[]'::jsonb,           -- reports d'année : [{ "fromYear": 2026, "toYear": 2027 }, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.objectives is 'Grands objectifs définis par l''utilisateur (ex: réussir un diplôme)';

-- ---------------------------------------------------------
-- TABLE: routines
-- Les créneaux hebdomadaires récurrents, rattachés à un objectif
-- ---------------------------------------------------------
create table if not exists public.routines (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = dimanche ... 6 = samedi
  label text not null,             -- ex: "Comptabilité"
  planned_hours numeric(4,2) not null default 0, -- ex: 2.00
  start_time time,                 -- heure de début du créneau
  end_time time,                   -- heure de fin du créneau (pour la Journée type)
  is_priority boolean not null default false, -- ex: "Réviser compta" marquée prioritaire
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.routines is 'Créneaux récurrents par jour de la semaine (routine hebdomadaire)';

-- ---------------------------------------------------------
-- TABLE: agenda_tasks
-- Tâches ponctuelles sur une plage de dates (par opposition aux routines,
-- qui se répètent chaque semaine sur un jour donné). Alimente l'onglet
-- Agenda, et remonte automatiquement dans Check-liste chaque jour de la
-- plage. Peut optionnellement occuper un créneau horaire de la Journée
-- type (planning_start/planning_end) — dans ce cas elle doit respecter
-- les mêmes règles de non-chevauchement que les blocs de la journée type.
-- ---------------------------------------------------------
create table if not exists public.agenda_tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  objective_id uuid references public.objectives(id) on delete set null, -- optionnel
  start_date date not null,
  end_date date not null,
  planning_start time,             -- optionnel : créneau dans la journée type
  planning_end time,                -- optionnel : créneau dans la journée type
  is_priority boolean not null default false,
  label text not null,
  planned_hours numeric(4,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenda_tasks_date_order check (end_date >= start_date)
);

comment on table public.agenda_tasks is 'Tâches ponctuelles rattachées à une date précise (agenda)';

-- ---------------------------------------------------------
-- TABLE: daily_logs
-- Le check-in du soir : une ligne par (routine OU tâche d'agenda, date)
-- ---------------------------------------------------------
create type public.task_status as enum ('done', 'partial', 'not_done');

create table if not exists public.daily_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  agenda_task_id uuid references public.agenda_tasks(id) on delete set null,
  objective_id uuid references public.objectives(id) on delete cascade, -- optionnel (tâche d'agenda libre)
  log_date date not null,
  status public.task_status not null default 'not_done',
  planned_hours numeric(4,2) not null default 0,
  actual_hours numeric(4,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_logs_one_source check (
    (routine_id is not null and agenda_task_id is null) or
    (routine_id is null and agenda_task_id is not null)
  ),
  unique (user_id, routine_id, agenda_task_id, log_date)
);

comment on table public.daily_logs is 'Check-in quotidien : statut de la tâche et heures réellement effectuées';

-- ---------------------------------------------------------
-- TABLE: profiles
-- Infos de profil affichées dans l'onglet "Profil" (nom, prénom).
-- L'email et le mot de passe restent gérés par Supabase Auth
-- (auth.users / supabase.auth.updateUser) — on ne les duplique pas ici.
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  reminder_enabled boolean not null default false,
  reminder_time time not null default '20:00',
  phone text,                                           -- ex: +33612345678 (format E.164 requis par Twilio)
  timezone text not null default 'Europe/Paris',
  last_reminder_sent_date date,                         -- évite les doublons d'envoi le même jour
  weekly_limits jsonb not null default '{}'::jsonb,     -- ex: { "Travail": 40, "Sport": 8 }
  day_template jsonb not null default '[]'::jsonb,      -- ex: [{ "start": "23:00", "end": "08:00", "label": "Sommeil" }, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profil utilisateur (nom / prénom) — 1 ligne par utilisateur Auth';

-- Crée automatiquement une ligne profiles à l'inscription (signup)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, first_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'first_name', ''));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------
create index if not exists idx_routines_objective on public.routines(objective_id);
create index if not exists idx_routines_user_day on public.routines(user_id, day_of_week);
create index if not exists idx_daily_logs_user_date on public.daily_logs(user_id, log_date);
create index if not exists idx_daily_logs_objective on public.daily_logs(objective_id);
create index if not exists idx_agenda_tasks_user_date on public.agenda_tasks(user_id, start_date, end_date);

-- ---------------------------------------------------------
-- TRIGGER: updated_at auto
-- ---------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_objectives_updated_at before update on public.objectives
  for each row execute function public.set_updated_at();

create trigger trg_routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();

create trigger trg_daily_logs_updated_at before update on public.daily_logs
  for each row execute function public.set_updated_at();

create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_agenda_tasks_updated_at before update on public.agenda_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------
alter table public.objectives enable row level security;
alter table public.routines enable row level security;
alter table public.daily_logs enable row level security;
alter table public.profiles enable row level security;
alter table public.agenda_tasks enable row level security;

create policy "Users manage their own objectives"
  on public.objectives for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own routines"
  on public.routines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own daily_logs"
  on public.daily_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users manage their own agenda_tasks"
  on public.agenda_tasks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- VUE UTILE: statut couleur par jour (calculé côté SQL, optionnel
-- si vous préférez calculer côté client — voir lib/calculations.ts)
-- ---------------------------------------------------------
create or replace view public.daily_status_view as
select
  dl.id,
  dl.user_id,
  dl.objective_id,
  dl.log_date,
  dl.status,
  dl.planned_hours,
  dl.actual_hours,
  case
    when dl.status = 'done' and dl.actual_hours >= dl.planned_hours and dl.planned_hours > 0 then 'green'
    when dl.status in ('done', 'partial') and dl.actual_hours > 0 then 'orange'
    else 'red'
  end as color_code
from public.daily_logs dl;

-- ---------------------------------------------------------
-- MIGRATION — à exécuter si vous aviez déjà lancé une version
-- antérieure de ce script (daily_logs sans agenda_task_id, etc.)
-- Sans effet si vous partez d'une base neuve (les "create table"
-- ci-dessus ont déjà tout créé correctement).
-- ---------------------------------------------------------
alter table public.daily_logs alter column objective_id drop not null;
alter table public.daily_logs add column if not exists agenda_task_id uuid references public.agenda_tasks(id) on delete set null;

alter table public.daily_logs drop constraint if exists daily_logs_routine_id_log_date_key;
alter table public.daily_logs drop constraint if exists daily_logs_user_id_routine_id_log_date_key;
alter table public.daily_logs drop constraint if exists daily_logs_one_source;
alter table public.daily_logs add constraint daily_logs_one_source check (
  (routine_id is not null and agenda_task_id is null) or
  (routine_id is null and agenda_task_id is not null)
);

alter table public.daily_logs drop constraint if exists daily_logs_user_id_routine_id_agenda_task_id_log_date_key;
alter table public.daily_logs add constraint daily_logs_user_id_routine_id_agenda_task_id_log_date_key
  unique (user_id, routine_id, agenda_task_id, log_date);

-- agenda_tasks : passage d'une date unique (task_date) à une plage
-- (start_date/end_date), + créneau planning et priorité.
alter table public.agenda_tasks add column if not exists start_date date;
alter table public.agenda_tasks add column if not exists end_date date;
update public.agenda_tasks set start_date = task_date where start_date is null and exists (
  select 1 from information_schema.columns where table_name='agenda_tasks' and column_name='task_date'
);
update public.agenda_tasks set end_date = start_date where end_date is null;
alter table public.agenda_tasks alter column start_date set not null;
alter table public.agenda_tasks alter column end_date set not null;
alter table public.agenda_tasks add column if not exists planning_start time;
alter table public.agenda_tasks add column if not exists planning_end time;
alter table public.agenda_tasks add column if not exists is_priority boolean not null default false;
alter table public.agenda_tasks drop constraint if exists agenda_tasks_date_order;
alter table public.agenda_tasks add constraint agenda_tasks_date_order check (end_date >= start_date);
alter table public.agenda_tasks drop column if exists task_date;

-- routines : ajout du marqueur "prioritaire"
alter table public.routines add column if not exists is_priority boolean not null default false;
alter table public.routines add column if not exists end_time time;

-- profiles : champs nécessaires aux rappels par SMS (Edge Function + Twilio)
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists timezone text not null default 'Europe/Paris';
alter table public.profiles add column if not exists last_reminder_sent_date date;

-- ---------------------------------------------------------
-- CRON : déclenche send-reminders toutes les minutes
-- ---------------------------------------------------------
-- 1. Dans Supabase : Database > Extensions, activez "pg_cron" et "pg_net".
-- 2. Déployez la fonction : supabase functions deploy send-reminders
-- 3. Définissez les secrets Twilio :
--    supabase secrets set TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=xxx TWILIO_FROM_NUMBER=+33...
-- 4. Remplacez <project-ref> et <anon-key> ci-dessous, puis exécutez ce bloc
--    dans le SQL Editor (une seule fois) :
--
-- select cron.schedule(
--   'send-reminders-every-minute',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/send-reminders',
--     headers := jsonb_build_object('Authorization', 'Bearer <anon-key>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- Pour arrêter le cron : select cron.unschedule('send-reminders-every-minute');
