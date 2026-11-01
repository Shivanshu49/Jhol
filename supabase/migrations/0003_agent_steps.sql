-- One row per agent step (what it did on which page), written live by the worker while it shops.
-- Screenshots live in the public Storage bucket "screens" at <auditId>/<session>/<idx>.jpg.

create table if not exists run_steps (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references runs(id) on delete cascade,
  idx             int  not null,                               -- 1-based step number
  page            text not null,                               -- home, product, cart, checkout, review, payment, ...
  action          text not null,                               -- e.g. click "Add to cart"
  reason          text,                                        -- the agent's one-line why
  screenshot_path text,                                        -- path inside the "screens" bucket
  total_shown     numeric,                                     -- price / total visible on that page
  created_at      timestamptz not null default now(),
  unique (run_id, idx)                                         -- a retried job overwrites, never duplicates
);

alter table run_steps enable row level security; -- server-only, like the other tables

-- Public read is fine for the demo: paths are unguessable audit UUIDs. Only the worker (service_role) uploads.
insert into storage.buckets (id, name, public) values ('screens', 'screens', true) on conflict (id) do nothing;
