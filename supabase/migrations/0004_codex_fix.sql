-- Codex fixes live in a separate store repo; the original report keeps the before/after receipt.
alter table audits
  add column if not exists fix_status text check (fix_status in ('queued', 'fixing', 'pr_opened', 'rechecking', 'done', 'failed')),
  add column if not exists fix_pr_url text,
  add column if not exists fix_branch text,
  add column if not exists fixed_audit_id uuid references audits(id) on delete set null,
  add column if not exists fix_error text,
  add column if not exists fix_message text,
  add column if not exists fix_diff_summary text;
