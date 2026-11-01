-- Legal precedents (Exa search results) per dark pattern, shown under each finding.
-- The worker searches each pattern at most once a day; this table is the cache shared by all workers.

create table if not exists precedents (
  pattern    text primary key,                               -- e.g. drip_pricing
  results    jsonb not null default '[]'::jsonb,             -- [{ title, url, publishedDate?, snippet }]
  fetched_at timestamptz not null default now()
);

-- What FINALIZE attached to this audit: { [pattern]: [{ title, url, publishedDate?, snippet }] }
alter table audits add column if not exists precedents jsonb not null default '{}'::jsonb;

alter table precedents enable row level security; -- server-only, like the other tables
