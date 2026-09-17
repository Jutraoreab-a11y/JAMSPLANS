-- =========================================================
-- SCHEMA SUPABASE — Tracker de Discipline & Objectifs
-- =========================================================
-- À exécuter dans l'éditeur SQL de Supabase (Project > SQL Editor)
-- =========================================================

-- ---------------------------------------------------------
-- TABLE: objectives
-- Les grands objectifs de l'utilisateur (ex: "Valider le DCG")
-- ---------------------------------------------------------
create table if not exists public.objectives (
  id uuid primary key default gen_random_uuid(),
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
  id uuid primary key default gen_random_uuid(),
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
  id uuid primary key default gen_random_uuid(),
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
do $$
begin
  create type public.task_status as enum ('done', 'partial', 'not_done');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  agenda_task_id uuid references public.agenda_tasks(id) on delete set null,
  objective_id uuid references public.objectives(id) on delete cascade, -- optionnel (tâche d'agenda libre)
  log_date date not null,
  status public.task_status not null default 'not_done',
  planned_hours numeric(4,2) not null default 0,
  actual_hours numeric(4,2) not null default 0,
  note text,
  excused_reason text,                                  -- 'malade' | 'conges_payes' | null : exception qui ne compte pas comme un échec
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_logs_one_source check (
    (routine_id is not null and agenda_task_id is null) or
    (routine_id is null and agenda_task_id is not null)
  )
  -- Pas d'unique(...) ici : voir la contrainte "unique nulls not distinct"
  -- ajoutée juste après la table (NULL != NULL par défaut en SQL, donc un
  -- unique(...) classique portant sur routine_id/agenda_task_id ne détecte
  -- jamais de conflit puisque l'un des deux est toujours NULL).
);

comment on table public.daily_logs is 'Check-in quotidien : statut de la tâche et heures réellement effectuées';

-- Idempotent : ajoute la colonne sur une base déjà créée avant son introduction.
alter table public.daily_logs add column if not exists excused_reason text;

-- Corrige la contrainte "unique (user_id, routine_id, agenda_task_id,
-- log_date)" ci-dessus : en SQL, deux valeurs NULL ne sont jamais considérées
-- égales, donc cette contrainte ne détectait JAMAIS de conflit pour les
-- tâches d'agenda (routine_id toujours NULL pour elles) — chaque
-- enregistrement du soir créait une nouvelle ligne au lieu de mettre à jour
-- la précédente.
--
-- Première tentative (deux index uniques partiels) incorrecte : PostgreSQL
-- ne peut cibler un index unique PARTIEL depuis ON CONFLICT que si la clause
-- répète exactement son "where", ce que l'upsert de Supabase ne permet pas
-- de faire — résultat : "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" sur CHAQUE enregistrement. On
-- supprime ces deux index et on les remplace par UNE seule contrainte
-- "unique nulls not distinct" (PostgreSQL 15+), qui traite deux NULL comme
-- égaux uniquement pour cette contrainte : exactement ce qu'il faut ici, et
-- compatible avec l'onConflict d'origine (une seule liste de colonnes).
drop index if exists public.daily_logs_routine_unique;
drop index if exists public.daily_logs_agenda_unique;
alter table public.daily_logs drop constraint if exists daily_logs_user_id_routine_id_agenda_task_id_log_date_key;
alter table public.daily_logs drop constraint if exists daily_logs_unique_nulls_not_distinct;
alter table public.daily_logs add constraint daily_logs_unique_nulls_not_distinct
  unique nulls not distinct (user_id, routine_id, agenda_task_id, log_date);

-- Si une tâche d'agenda est supprimée (ex: resynchronisation des prières, ou
-- suppression manuelle depuis l'onglet Agenda) alors qu'elle a déjà un
-- check-in enregistré, l'ancienne règle "on delete set null" mettait
-- agenda_task_id à NULL sur ce log — ce qui violait aussitôt la contrainte
-- daily_logs_one_source (plus aucune source renseignée) et faisait échouer
-- la suppression avec une erreur. On supprime maintenant proprement le log
-- devenu obsolète en même temps que sa tâche.
alter table public.daily_logs drop constraint if exists daily_logs_agenda_task_id_fkey;
alter table public.daily_logs add constraint daily_logs_agenda_task_id_fkey
  foreign key (agenda_task_id) references public.agenda_tasks(id) on delete cascade;

-- ---------------------------------------------------------
-- TABLE: profiles
-- Infos de profil affichées dans l'onglet "Profil" (prénom uniquement —
-- le champ "Nom" a été retiré). L'email et le mot de passe restent gérés
-- par Supabase Auth (auth.users / supabase.auth.updateUser) — on ne les
-- duplique pas ici.
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  phone text,                                           -- ex: +33612345678, utilisé si le canal du rappel = SMS
  reminder_enabled boolean not null default false,
  reminder_time time not null default '20:00',
  reminder_webhook_url text,                            -- URL de webhook Make.com déclenché au moment du rappel
  reminder_channel text not null default 'email',       -- ancien champ, conservé pour compat (non utilisé pour l'envoi)
  reminder_channel_email boolean not null default true, -- rappel par mail (case à cocher, indépendante du SMS)
  reminder_channel_sms boolean not null default false,  -- rappel par SMS (case à cocher, indépendante du mail)
  timezone text not null default 'Europe/Paris',
  last_reminder_sent_date date,                         -- évite les doublons d'envoi le même jour
  weekly_limits jsonb not null default '{}'::jsonb,     -- ex: { "Travail": 40, "Sport": 8 }
  day_template jsonb not null default '[]'::jsonb,      -- ex: [{ "start": "23:00", "end": "08:00", "label": "Sommeil" }, ...]
  prayer_city text,                                     -- ville choisie pour les horaires de prière (ex: 'Africa/Abidjan') ; vide = désactivé
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profil utilisateur (prénom, rappel du soir) — 1 ligne par utilisateur Auth';

-- Mises à jour idempotentes pour les bases déjà créées avant l'ajout des
-- champs ci-dessus (safe à ré-exécuter : IF EXISTS / IF NOT EXISTS partout).
alter table public.profiles drop column if exists last_name;
alter table public.profiles add column if not exists reminder_webhook_url text;
alter table public.profiles add column if not exists reminder_channel text not null default 'email';
-- Cases à cocher indépendantes (mail ET/OU SMS) qui remplacent l'ancien
-- choix unique reminder_channel ci-dessus (conservée pour compat).
alter table public.profiles add column if not exists reminder_channel_email boolean not null default true;
alter table public.profiles add column if not exists reminder_channel_sms boolean not null default false;
-- Horaires de prière : ville choisie par l'utilisateur (une des valeurs du
-- menu Profil, ex: 'Africa/Abidjan') servant à calculer les 5 horaires du
-- jour via l'API Aladhan ; NULL/vide désactive la fonctionnalité.
alter table public.profiles add column if not exists prayer_city text;
-- Bouton "Musulman" du Profil : active/désactive l'affichage des 5 prières
-- quotidiennes (Check-liste, Profil). La ville reste utilisée pour la météo
-- même si ce bouton est décoché.
alter table public.profiles add column if not exists prayer_enabled boolean not null default false;

-- Crée automatiquement une ligne profiles à l'inscription (signup)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, first_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  );
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

drop trigger if exists trg_objectives_updated_at on public.objectives;
create trigger trg_objectives_updated_at before update on public.objectives
  for each row execute function public.set_updated_at();

drop trigger if exists trg_routines_updated_at on public.routines;
create trigger trg_routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_logs_updated_at on public.daily_logs;
create trigger trg_daily_logs_updated_at before update on public.daily_logs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_agenda_tasks_updated_at on public.agenda_tasks;
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

drop policy if exists "Users manage their own objectives" on public.objectives;
create policy "Users manage their own objectives"
  on public.objectives for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own routines" on public.routines;
create policy "Users manage their own routines"
  on public.routines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own daily_logs" on public.daily_logs;
create policy "Users manage their own daily_logs"
  on public.daily_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own profile" on public.profiles;
create policy "Users manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users manage their own agenda_tasks" on public.agenda_tasks;
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

-- (Le bloc de migration pour d'anciennes installations a été retiré : 
--  toutes les colonnes qu'il ajoutait sont déjà présentes dans les "create table"
--  ci-dessus. Sur une base neuve, une des lignes de ce bloc échouait toujours
--  avec "column \"task_date\" does not exist", car Postgres valide la référence
--  à cette colonne à l'analyse de la requête, avant même de vérifier la condition
--  "exists (...)" censée la protéger — et comme Supabase exécute tout le script
--  dans une seule transaction, cette erreur annulait aussi toutes les tables déjà
--  créées juste avant.)

-- ---------------------------------------------------------
-- CRON : déclenche send-reminders toutes les minutes
-- ---------------------------------------------------------
-- 1. Dans Supabase : Database > Extensions, activez "pg_cron" et "pg_net".
-- 2. Déployez la fonction : supabase functions deploy send-reminders
--    (elle appelle directement le webhook Make.com renseigné par chaque
--    utilisateur dans Profil > Rappel du soir — aucun secret Twilio requis.)
-- 3. (rien à configurer côté secrets : chaque profil porte sa propre URL de webhook)
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
