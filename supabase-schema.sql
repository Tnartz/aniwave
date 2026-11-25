-- AniWave: пользовательское избранное
-- Выполните этот файл целиком в Supabase -> SQL Editor -> New query.

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  anime_title text not null,
  created_at timestamptz not null default now(),
  constraint favorites_user_anime_unique unique (user_id, anime_title)
);

alter table public.favorites enable row level security;

grant usage on schema public to authenticated;
grant select, insert, delete on public.favorites to authenticated;

drop policy if exists "Users can view their own favorites" on public.favorites;
create policy "Users can view their own favorites"
on public.favorites for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can add their own favorites" on public.favorites;
create policy "Users can add their own favorites"
on public.favorites for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own favorites" on public.favorites;
create policy "Users can delete their own favorites"
on public.favorites for delete
to authenticated
using (auth.uid() = user_id);
