# JamsPlans — Tracker d'Objectifs & de Planning

Application Next.js (App Router) + Supabase pour planifier des routines,
faire un check-in quotidien et suivre un score de discipline / performance.

## 1. Mise en place de Supabase

1. Créez un projet sur [supabase.com](https://supabase.com).
2. Dans **SQL Editor**, exécutez le contenu de `supabase/schema.sql`.
   Cela crée les tables `objectives`, `routines`, `daily_logs`, active
   Row Level Security et pose les policies (chaque utilisateur ne voit
   que ses propres données).
3. Activez une méthode d'authentification (Email/Password suffit pour
   démarrer) dans **Authentication > Providers**.
4. Copiez `.env.local.example` vers `.env.local` et renseignez :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Project Settings > API dans Supabase)

## 2. Installation

```bash
npm install
npm run dev
```

L'app tourne sur http://localhost:3000.

> Note : ce squelette suppose qu'un utilisateur est déjà connecté via
> Supabase Auth (`supabase.auth.getUser()`). Ajoutez un écran de
> login/signup Supabase Auth UI si vous n'en avez pas encore un —
> ce n'était pas dans le périmètre demandé, mais `lib/supabase.ts`
> est prêt à l'emploi pour `supabase.auth.signInWithPassword(...)`.

## 3. Structure du projet

```
supabase/schema.sql              → schéma SQL complet (tables, RLS, vue de couleur)
lib/supabase.ts                  → client Supabase (utilitaire, non utilisé par page.tsx)
app/jamsplans.css                → CSS de toute l'app (extrait de prototype.html)
components/jamsplans-markup.ts   → HTML de toute l'app (extrait de prototype.html)
components/jamsplans-runtime.ts  → logique JS de toute l'app : objectifs, planning,
                                    agenda, check-in, journée type, dashboard, archive,
                                    profil, rappels, limites hebdo (extrait de prototype.html)
app/page.tsx                     → monte le markup + lance jamsplans-runtime au chargement
```

## 4. Logique de scoring (components/jamsplans-runtime.ts)

- **Couleur d'un jour** :
  - 🟢 vert : tâche faite ET heures réelles ≥ heures prévues
  - 🟠 orange : tâche faite/partielle mais heures < prévues
  - 🔴 rouge : non faite ou 0h réalisée
- **Score de Discipline (%)** = jours verts / jours renseignés × 100
- **Score de Performance (%)** = Σ heures réelles / Σ heures prévues × 100
- **Streak** = nombre de jours verts consécutifs, en partant du plus récent

Ces calculs sont faits côté client (sur les logs déjà chargés) pour rester
réactifs ; la vue SQL `daily_status_view` fournit l'équivalent côté base
si vous préférez agréger en SQL (ex: pour des rapports).

## 5. Déploiement

Le projet est prêt pour Vercel :

```bash
vercel deploy
```

Pensez à renseigner les variables d'environnement Supabase dans les
réglages du projet Vercel.

## 6. Pistes d'amélioration (hors périmètre initial)

- Écran d'authentification (Supabase Auth UI ou formulaire custom)
- Édition/suppression d'un check-in déjà enregistré depuis le dashboard
- Notifications push/email pour rappeler le check-in du soir
- Export CSV des `daily_logs`

## 0. app/page.tsx = prototype.html, porté dans Next.js

Depuis la mise à jour "JamsPlans", `app/page.tsx` affiche exactement le
design et le comportement de `prototype.html`, mais branché en vrai sur ce
projet Next.js :

- `components/jamsplans-markup.ts` contient le HTML de `prototype.html`
  (extrait tel quel).
- `components/jamsplans-runtime.ts` contient toute la logique JS de
  `prototype.html` (extraite telle quelle), adaptée pour lire
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` depuis
  `.env.local` au lieu des valeurs codées en dur du fichier autonome.
- `app/jamsplans.css` contient le CSS extrait du même fichier.

`prototype.html` reste disponible à la racine comme référence / bac à
sable, mais l'app réelle (`npm run dev` puis `/`) est maintenant identique.

## 7. prototype.html — version autonome branchée sur Supabase

`prototype.html` est une page unique (HTML/CSS/JS, sans build) qui reproduit
toute l'app. Elle peut désormais se connecter à Supabase pour de vrai :

1. Ouvrez `prototype.html`, repérez le bloc `CONFIGURATION SUPABASE` en haut
   du `<script>`.
2. Renseignez `SUPABASE_URL` et `SUPABASE_ANON_KEY` (Project Settings > API).
3. Tant que ces valeurs ne sont pas renseignées, le fichier tourne en
   **mode démo local** (données en mémoire, bannière violette en haut).
   Dès qu'elles sont renseignées, un écran de connexion/inscription
   apparaît et toutes les actions (objectifs, routines, check-in, profil,
   changement de mot de passe) écrivent réellement dans Supabase.
4. La table `profiles` (nom/prénom) et les colonnes `achieved` /
   `current_year` / `history` sur `objectives` sont incluses dans
   `supabase/schema.sql` — relancez ce script si vous l'aviez déjà exécuté
   avant cette mise à jour.
5. Par défaut la session n'est pas persistée dans le navigateur
   (`persistSession: false`) pour éviter toute dépendance au
   `localStorage` dans les aperçus sandboxés. Pour un vrai déploiement,
   passez cette option à `true` afin de garder la session entre deux
   visites.

## 8. Rappels par SMS (Edge Function + Twilio)

Le rappel intégré au navigateur ne fonctionne que si l'onglet reste ouvert.
Pour un vrai SMS qui arrive même app/onglet fermés, une Edge Function
Supabase est fournie dans `supabase/functions/send-reminders/`.

**Mise en place :**
1. Créez un compte [Twilio](https://www.twilio.com) et récupérez : Account SID, Auth Token, et achetez un numéro d'envoi.
2. Activez les extensions `pg_cron` et `pg_net` (Database > Extensions dans Supabase).
3. Installez la CLI Supabase, puis déployez la fonction :
   ```bash
   supabase functions deploy send-reminders
   ```
4. Définissez les secrets Twilio :
   ```bash
   supabase secrets set TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=xxx TWILIO_FROM_NUMBER=+33xxxxxxxxx
   ```
5. Dans le SQL Editor, programmez le cron (instructions et exemple de requête
   en bas de `supabase/schema.sql`, section "CRON").
6. Dans l'app, onglet Profil > Rappel du soir : renseignez votre numéro de
   téléphone (format international, ex: `+33612345678`) et votre fuseau
   horaire, puis "Enregistrer le rappel".

La fonction tourne toutes les minutes, vérifie qui doit recevoir un rappel
à cette heure précise (dans son fuseau), regarde s'il reste des tâches non
cochées ce jour-là, et envoie le SMS le cas échéant — un seul envoi par
jour et par personne.
