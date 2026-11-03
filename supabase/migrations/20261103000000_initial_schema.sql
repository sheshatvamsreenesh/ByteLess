create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.optimization_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  source text not null default '' check (char_length(source) <= 2048),
  content_type text not null default 'text' check (content_type in ('webpage', 'html', 'text', 'pdf-text')),
  mode text not null check (mode in ('light', 'ultra', 'terminal')),
  original_bytes bigint not null check (original_bytes >= 0),
  converted_bytes bigint not null check (converted_bytes >= 0),
  converted_html text not null default '',
  converted_text text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  removed_elements integer not null default 0 check (removed_elements >= 0),
  trackers_detected integer not null default 0 check (trackers_detected >= 0),
  images_deferred integer not null default 0 check (images_deferred >= 0),
  measurement_scope text not null default '',
  created_at timestamptz not null default now(),
  constraint optimization_history_id_user_unique unique (id, user_id),
  constraint optimization_history_content_size check (octet_length(converted_html) + octet_length(converted_text) <= 5242880)
);

create table if not exists public.file_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  history_id uuid not null unique,
  filename text not null check (char_length(filename) between 1 and 255),
  mime_type text not null check (mime_type in ('text/html', 'application/pdf')),
  original_bytes bigint not null check (original_bytes >= 0),
  converted_bytes bigint not null check (converted_bytes >= 0),
  created_at timestamptz not null default now(),
  constraint file_metadata_history_owner_fk foreign key (history_id, user_id)
    references public.optimization_history (id, user_id) on delete cascade
);

create table if not exists public.optimization_statistics (
  history_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  original_bytes bigint not null check (original_bytes >= 0),
  converted_bytes bigint not null check (converted_bytes >= 0),
  bytes_saved bigint not null,
  percentage_saved numeric(9, 2) not null,
  mode text not null check (mode in ('light', 'ultra', 'terminal')),
  images_detected integer not null default 0 check (images_detected >= 0),
  images_preserved integer not null default 0 check (images_preserved >= 0),
  images_optimized integer not null default 0 check (images_optimized >= 0),
  images_deferred integer not null default 0 check (images_deferred >= 0),
  images_omitted integer not null default 0 check (images_omitted >= 0),
  scripts_detected integer not null default 0 check (scripts_detected >= 0),
  scripts_removed integer not null default 0 check (scripts_removed >= 0),
  trackers_detected integer not null default 0 check (trackers_detected >= 0),
  trackers_removed integer not null default 0 check (trackers_removed >= 0),
  created_at timestamptz not null default now(),
  constraint optimization_statistics_actual_bytes check (bytes_saved = original_bytes - converted_bytes),
  constraint optimization_statistics_history_owner_fk foreign key (history_id, user_id)
    references public.optimization_history (id, user_id) on delete cascade
);

create index if not exists optimization_history_user_created_idx
  on public.optimization_history (user_id, created_at desc);
create index if not exists optimization_history_user_mode_idx
  on public.optimization_history (user_id, mode);
create index if not exists file_metadata_user_created_idx
  on public.file_metadata (user_id, created_at desc);
create index if not exists optimization_statistics_user_created_idx
  on public.optimization_statistics (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.optimization_history enable row level security;
alter table public.file_metadata enable row level security;
alter table public.optimization_statistics enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = id);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = id);

drop policy if exists "Users can manage their own optimization history" on public.optimization_history;
create policy "Users can manage their own optimization history" on public.optimization_history
  for all to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Users can manage their own file metadata" on public.file_metadata;
create policy "Users can manage their own file metadata" on public.file_metadata
  for all to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Users can manage their own optimization statistics" on public.optimization_statistics;
create policy "Users can manage their own optimization statistics" on public.optimization_statistics
  for all to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on public.profiles, public.optimization_history, public.file_metadata, public.optimization_statistics from anon, public;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.optimization_history to authenticated;
grant select, insert, update, delete on public.file_metadata to authenticated;
grant select, insert, update, delete on public.optimization_statistics to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100)
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = case when excluded.display_name <> '' then excluded.display_name else profiles.display_name end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''), left(coalesce(raw_user_meta_data ->> 'display_name', ''), 100)
from auth.users
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
