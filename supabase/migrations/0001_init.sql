-- Jhol — initial schema. Paste into Supabase → SQL editor → Run (or `supabase db push`).
-- Only the NestJS api/worker touch these tables, using the secret (service_role) key.

create table if not exists audits (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  journey      text not null default 'checkout',              -- later: signup, cancel, delete_account
  sessions     int  not null default 2 check (sessions in (1, 2)), -- 2 = run the false-urgency A/B test
  options      jsonb not null default '{}'::jsonb,            -- { stealth, indiaProxy, pincode }
  status       text not null default 'running'
               check (status in ('running', 'finalizing', 'done', 'failed')),
  error        text,
  price_shown  numeric,                                        -- first price the shopper saw
  price_final  numeric,                                        -- what they'd actually pay
  score        int,                                            -- jholScore(): 100 = clean
  report_hash  text,                                           -- sealReport(): SHA-256 of the final report
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists runs (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid not null references audits(id) on delete cascade,
  session         text not null check (session in ('A', 'B')), -- B starts ~2 min after A
  tinyfish_run_id text unique,
  status          text not null default 'PENDING',            -- mirrors TinyFish: PENDING/RUNNING/COMPLETED/FAILED/CANCELLED
  streaming_url   text,                                       -- live browser view while running
  video_url       text,                                       -- recording, if the account has it
  started_at      timestamptz,
  num_steps       int,                                        -- = TinyFish credits used
  result          jsonb,                                      -- normalised JourneyResult
  error           text,
  created_at      timestamptz not null default now(),
  unique (audit_id, session)
);

create table if not exists findings (
  id         uuid primary key default gen_random_uuid(),
  audit_id   uuid not null references audits(id) on delete cascade,
  pattern    text not null,                                   -- one of CCPA's 13 dark patterns
  severity   text not null check (severity in ('high', 'medium', 'low')),
  page       text,
  evidence   text,                                            -- exact text the agent captured
  detail     text,
  source     text not null check (source in ('rule', 'llm')),
  created_at timestamptz not null default now()
);

create index if not exists audits_created_idx on audits (created_at desc);
create index if not exists runs_audit_idx on runs (audit_id);
create index if not exists findings_audit_idx on findings (audit_id);

-- Locked by default: no public policies, so browsers can't read or write directly.
-- When you add Supabase Auth + orgs, add org-scoped SELECT policies (needed for Realtime too).
alter table audits   enable row level security;
alter table runs     enable row level security;
alter table findings enable row level security;
