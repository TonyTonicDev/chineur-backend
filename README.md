# Chineur. — Backend Vercel

Proxy API sécurisé + système communautaire complet.

## Structure des fichiers

```
api/
  analyze.js                ← analyse photo via Anthropic
  me.js                     ← statut utilisateur/premium
  create-checkout.js        ← abonnement Stripe 1,99€/mois
  webhook-stripe.js         ← sync abonnements Stripe → Supabase
  community/
    finds.js                ← GET top du mois / POST partager trouvaille
    vote.js                 ← voter pour une trouvaille (up/down)
    comments.js             ← GET/POST/DELETE commentaires
    profile.js              ← GET/PATCH profil utilisateur
lib/
  supabase.js / auth.js / subscription.js / cors.js
```

## Endpoints

| Méthode | URL | Auth | Description |
|---------|-----|------|-------------|
| POST | /api/analyze | ✅ | Analyse une photo |
| GET | /api/me | ✅ | Statut premium |
| POST | /api/create-checkout | ✅ | Lien paiement Stripe |
| POST | /api/webhook-stripe | ❌ | Webhook Stripe |
| GET | /api/community/finds | ❌ | Top 10 du mois |
| POST | /api/community/finds | ✅ | Partager une trouvaille |
| POST | /api/community/vote | ✅ | Voter |
| GET | /api/community/comments?find_id=X | ❌ | Commentaires |
| POST | /api/community/comments?find_id=X | ✅ | Ajouter commentaire |
| DELETE | /api/community/comments?find_id=X | ✅ | Supprimer commentaire |
| GET | /api/community/profile | ✅ | Mon profil |
| PATCH | /api/community/profile | ✅ | Modifier profil |
| POST | /api/feedback | ➕ | Envoyer un feedback |
| PATCH | /api/community/profile | ✅ | Modifier profil |

## Score communautaire

```
score = (votes_positifs - votes_négatifs) × prix_revente_max
```
Un objet à 50€ avec ratio votes 10x > un objet à 100€ peu voté → il passe devant.

---

## SQL Supabase — à exécuter dans l'éditeur SQL

```sql
-- Profils utilisateurs
create table profiles (
  id uuid references auth.users primary key,
  username text unique,
  avatar_url text,
  stripe_customer_id text,
  created_at timestamptz default now()
);

-- Abonnements Stripe
create table subscriptions (
  user_id uuid references auth.users primary key,
  stripe_subscription_id text,
  status text,
  current_period_end timestamptz,
  updated_at timestamptz default now()
);

-- Compteur d'usage quotidien
create table usage (
  id bigserial primary key,
  user_id uuid references auth.users,
  date date,
  created_at timestamptz default now()
);
create index on usage(user_id, date);

-- Trouvailles partagées dans le top communautaire
create table finds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  detail text,
  verdict text,
  prix_revente numeric default 0,
  image_url text,
  analyse text,
  month text not null, -- format "2026-04"
  created_at timestamptz default now()
);
create index on finds(month);

-- Votes (up/down) sur les trouvailles
create table votes (
  id uuid primary key default gen_random_uuid(),
  find_id uuid references finds on delete cascade not null,
  user_id uuid references auth.users not null,
  direction text check (direction in ('up','down')) not null,
  created_at timestamptz default now(),
  unique(find_id, user_id) -- un seul vote par utilisateur par trouvaille
);

-- Commentaires sur les trouvailles
create table comments (
  id uuid primary key default gen_random_uuid(),
  find_id uuid references finds on delete cascade not null,
  user_id uuid references auth.users not null,
  text text not null,
  created_at timestamptz default now()
);
create index on comments(find_id);


-- Feedbacks utilisateurs
create table feedbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  user_email text,
  type text check (type in ('bug','suggestion','autre')) default 'autre',
  message text not null,
  created_at timestamptz default now()
);
alter table feedbacks enable row level security;
create policy "Auth insert feedbacks" on feedbacks for insert with check (true); -- anyone can submit
create policy "Service read feedbacks" on feedbacks for select using (false); -- only service role

-- Sécurité Row Level Security
alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table usage enable row level security;
alter table finds enable row level security;
alter table votes enable row level security;
alter table comments enable row level security;

-- Policies : lecture publique, écriture authentifiée
create policy "Public read finds" on finds for select using (true);
create policy "Auth insert finds" on finds for insert with check (auth.uid() = user_id);

create policy "Public read votes" on votes for select using (true);
create policy "Auth insert votes" on votes for insert with check (auth.uid() = user_id);
create policy "Auth delete own votes" on votes for delete using (auth.uid() = user_id);
create policy "Auth update own votes" on votes for update using (auth.uid() = user_id);

create policy "Public read comments" on comments for select using (true);
create policy "Auth insert comments" on comments for insert with check (auth.uid() = user_id);
create policy "Auth delete own comments" on comments for delete using (auth.uid() = user_id);

create policy "Public read profiles" on profiles for select using (true);
create policy "Auth manage own profile" on profiles for all using (auth.uid() = id);

create policy "Auth manage own subscription" on subscriptions for all using (auth.uid() = user_id);
create policy "Auth manage own usage" on usage for all using (auth.uid() = user_id);
```

---

## Variables d'environnement Vercel

```
ANTHROPIC_API_KEY         = sk-ant-...
SUPABASE_URL              = https://gqxbquxrmebjraxjfznc.supabase.co
SUPABASE_SERVICE_ROLE_KEY = sb_secret_...
STRIPE_SECRET_KEY         = sk_live_...
STRIPE_PRICE_ID           = price_...
STRIPE_WEBHOOK_SECRET     = whsec_...
APP_URL                   = https://votre-app.vercel.app
RESEND_API_KEY            = re_... (optionnel — pour les emails de feedback)
```

## Déploiement Vercel

1. Créez un compte sur vercel.com (connectez-vous avec GitHub)
2. Créez un nouveau repo GitHub, uploadez ces fichiers
3. Importez le repo dans Vercel
4. Ajoutez les variables d'environnement ci-dessus
5. Déployez → vous obtenez une URL `https://chineur-backend.vercel.app`
