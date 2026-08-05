-- Phase 4: a course becomes a container for multiple holes, instead of being one hole itself.
-- Existing single-hole rows are preserved as one-hole courses, reusing the same id so any
-- bookmarked course.html?course=<id> link keeps working.

alter table courses rename to courses_legacy;

create table courses (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Course',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table holes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  hole_number int not null,
  par int not null default 4,
  grid_cols int not null,
  grid_rows int not null,
  tile_size numeric not null default 5,
  tiles jsonb not null default '[]'::jsonb,
  tee jsonb not null,
  pin jsonb not null,
  unique (course_id, hole_number)
);

-- Keeps the door open for leaderboards later (explicitly not building that UI yet) — a place
-- to land completed-round results per course as soon as rounds start finishing.
create table rounds (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  player_name text,
  hole_scores jsonb not null default '[]'::jsonb,
  total_strokes int,
  total_par int,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

insert into courses (id, name, is_public, created_at, updated_at)
select id, name, false, created_at, updated_at from courses_legacy;

insert into holes (course_id, hole_number, par, grid_cols, grid_rows, tile_size, tiles, tee, pin)
select id, 1, par, grid_cols, grid_rows, tile_size, tiles, tee, pin from courses_legacy;

drop table courses_legacy;

alter table courses enable row level security;
alter table holes enable row level security;
alter table rounds enable row level security;

-- Still no accounts (Phase 4 scope) — public/private is just a listing filter, not access
-- control; anyone with a course's id can still open and play it directly.
create policy "public read" on courses for select using (true);
create policy "public insert" on courses for insert with check (true);
create policy "public update" on courses for update using (true);

create policy "public read" on holes for select using (true);
create policy "public insert" on holes for insert with check (true);
create policy "public update" on holes for update using (true);
create policy "public delete" on holes for delete using (true);

create policy "public read" on rounds for select using (true);
create policy "public insert" on rounds for insert with check (true);
