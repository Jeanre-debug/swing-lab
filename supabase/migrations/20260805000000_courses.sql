create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Hole',
  par int not null default 4,
  grid_cols int not null,
  grid_rows int not null,
  tile_size numeric not null default 5,
  tiles jsonb not null default '[]'::jsonb,
  tee jsonb not null,
  pin jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table courses enable row level security;

-- No accounts yet (Phase 2 scope) — anyone can list, load, or save a course.
create policy "public read" on courses for select using (true);
create policy "public insert" on courses for insert with check (true);
create policy "public update" on courses for update using (true);
