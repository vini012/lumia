-- Lumiar v5: server migration for public.lumiar_mundo (run once in the Supabase SQL editor; safe to run again).
-- What it does:
--   1. allows the v5 collections p5 m5 b5 h5 t5 f5 k5 w5 d5 in the collections check (old names are kept);
--   2. raises the row size check on d to 32000 bytes;
--   3. adds a newer-wins guard for the v5 collections: an update carrying an older record time (d->>'t', or the at
--      column for deletions) than the stored row is ignored, so an old offline snapshot never overwrites newer data;
--   4. adds public.lumiar_now() (server clock for the game, read-only) and an index used for catch-up reads.
-- v4 rows and collections (builds4, cut4, ...) are not touched and keep their old behaviour.
-- The table is assumed to be: w text, c text, id text, d jsonb (null = removed), at (timestamp or ISO text),
-- primary key (w, c, id), in the supabase_realtime publication, with the anon policies v4 already uses.

begin;

-- 1 + 2 ---------------------------------------------------------------------------------------------------------
do $$
declare
  v5 text[] := array['p5','m5','b5','h5','t5','f5','k5','w5','d5'];
  r record;
  names text[] := array[]::text[];
  m text[];
  def text;
  lst text;
begin
  -- collections check: keep every name the current check allows, add the v5 ones
  for r in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    where con.conrelid = 'public.lumiar_mundo'::regclass and con.contype = 'c'
      and (con.conname = 'lumiar_mundo_c_check'
           or (pg_get_constraintdef(con.oid) ~ '\mc\M' and pg_get_constraintdef(con.oid) !~ '\md\M'))
  loop
    for m in select regexp_matches(r.def, '''([^'']+)''', 'g') loop
      names := array_append(names, m[1]);
    end loop;
    execute format('alter table public.lumiar_mundo drop constraint %I', r.conname);
  end loop;
  if coalesce(array_length(names, 1), 0) = 0 then
    raise notice 'no collections check found: every collection name is already allowed, none added';
  else
    select string_agg(quote_literal(n), ',' order by n) into lst
    from (select distinct unnest(names || v5) as n) s;
    execute 'alter table public.lumiar_mundo add constraint lumiar_mundo_c_check check (c in (' || lst || '))';
    raise notice 'lumiar_mundo_c_check now allows: %', lst;
  end if;

  -- size check on d: drop the old one(s), add a 32000-byte one
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.lumiar_mundo'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ '\md\M'
      and pg_get_constraintdef(con.oid) ~* '(octet_length|pg_column_size|length|char_length)'
  loop
    execute format('alter table public.lumiar_mundo drop constraint %I', r.conname);
    raise notice 'dropped old size check %', r.conname;
  end loop;
  alter table public.lumiar_mundo add constraint lumiar_mundo_d_size check (d is null or octet_length(d::text) <= 32000);
end $$;

-- 3 -------------------------------------------------------------------------------------------------------------
create or replace function public.lumiar_row_ms(d jsonb, at_text text) returns double precision
language sql stable as $$
  select coalesce(
    case when jsonb_typeof(d -> 't') = 'number' then (d ->> 't')::double precision end,
    case when at_text is not null and at_text <> '' then extract(epoch from at_text::timestamptz) * 1000 end,
    0)
$$;

create or replace function public.lumiar_newer_wins() returns trigger
language plpgsql as $$
begin
  if new.c in ('p5','m5','b5','h5','t5','f5','k5','w5','d5')
     and public.lumiar_row_ms(new.d, new.at::text) < public.lumiar_row_ms(old.d, old.at::text) then
    return null; -- keep the stored, newer row (the upsert succeeds without changing it)
  end if;
  return new;
end $$;

drop trigger if exists lumiar_newer_wins on public.lumiar_mundo;
create trigger lumiar_newer_wins before update on public.lumiar_mundo
  for each row execute function public.lumiar_newer_wins();

-- 4 -------------------------------------------------------------------------------------------------------------
create or replace function public.lumiar_now() returns timestamptz
language sql stable as $$ select now() $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.lumiar_now() to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.lumiar_now() to authenticated';
  end if;
end $$;

create index if not exists lumiar_mundo_w_at on public.lumiar_mundo (w, at);

commit;

-- Check after running (should list the v5 names, the 32000 check, the trigger and the function):
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.lumiar_mundo'::regclass;
--   select tgname from pg_trigger where tgrelid = 'public.lumiar_mundo'::regclass and not tgisinternal;
--   select public.lumiar_now();
-- If the anon RLS policies of lumiar_mundo restrict the collection names themselves (with check (c in (...))),
-- add the v5 names there too:
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'lumiar_mundo';
