-- =========================================================================
-- mySpring Suite — Sprint R1.2 (tuzatilgan) — Cloud Persistence (Supabase)
-- Bu fayl IDEMPOTENT — xavfsiz qayta-qayta ishga tushirish mumkin.
-- Supabase loyihangizning SQL Editor'ida to'liq ishga tushiring.
-- =========================================================================

-- ================= 1. JADVALLAR =================
create table if not exists public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  schema_version text not null,
  document_json jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_owner_id on public.projects(owner_id);
create index if not exists idx_projects_updated_at on public.projects(owner_id, updated_at desc);

create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/gif','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880), -- 5MB
  created_at timestamptz not null default now()
);
create index if not exists idx_project_assets_project_id on public.project_assets(project_id);
create index if not exists idx_project_assets_owner_id on public.project_assets(owner_id);

-- ================= 2. updated_at — DATABASE DARAJASIDA MAJBURIY (talab #4) =================
-- Trigger — hatto RPC tashqarisidan (gipotetik) UPDATE kelsa ham:
--   - updated_at HAR DOIM now() (mijoz/RPC yuborgan qiymat e'tiborga olinmaydi);
--   - revision AYNAN 1 taga oshishi SHART (aks holda xato — bu 3-bandning
--     asosiy himoyasi: revision tekshiruvini chetlab o'tib bo'lmaydi);
--   - id / owner_id / created_at o'zgarmasligi SHART.
create or replace function public.enforce_project_update_invariants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.id is distinct from OLD.id then
    raise exception 'project id o''zgartirib bo''lmaydi';
  end if;
  if NEW.owner_id is distinct from OLD.owner_id then
    raise exception 'project egaligi (owner_id) o''zgartirib bo''lmaydi';
  end if;
  if NEW.created_at is distinct from OLD.created_at then
    raise exception 'created_at o''zgartirib bo''lmaydi';
  end if;
  if NEW.revision is distinct from OLD.revision + 1 then
    raise exception 'revision aynan 1 taga oshishi kerak (joriy: %, yuborilgan: %)', OLD.revision, NEW.revision;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_enforce_project_update_invariants on public.projects;
create trigger trg_enforce_project_update_invariants
  before update on public.projects
  for each row execute function public.enforce_project_update_invariants();

-- ================= 3. ATOMIK SAQLASH RPC (talab #1) =================
-- INSERT ... exception-based fallback + FOR UPDATE qulfi orqali chinakam
-- atomik. Natija — mashina-o'qiy oladigan matn: created | updated |
-- conflict | forbidden | not_found.
create or replace function public.save_project_with_conflict_check(
  p_id uuid,
  p_name text,
  p_schema_version text,
  p_document jsonb,
  p_expected_revision bigint
) returns table(result text, new_revision bigint, server_updated_at timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_current_revision bigint;
  v_current_updated_at timestamptz;
begin
  if auth.uid() is null then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  -- (a) Atomik urinish: yangi qator sifatida INSERT.
  begin
    insert into public.projects (id, owner_id, name, schema_version, document_json, revision)
    values (p_id, auth.uid(), p_name, p_schema_version, p_document, 1);
    return query select 'created'::text, 1::bigint, now();
    return;
  exception when unique_violation then
    -- Qator allaqachon mavjud (yoki ikkita "birinchi saqlash" so'rovi
    -- bir-birini bosib o'tdi) — kutilmagan xato TASHLANMAYDI, pastdagi
    -- shartli-yangilash yo'liga o'tiladi.
    null;
  end;

  -- (b) Qatorni QULFLAB o'qish — tekshiruv va yangilanish orasida yana
  -- bir parallel so'rov kirib kelishining (check-then-act musobaqasi)
  -- oldini oladi.
  select owner_id, revision, updated_at
    into v_owner_id, v_current_revision, v_current_updated_at
    from public.projects
    where id = p_id
    for update;

  if v_owner_id is null then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_owner_id <> auth.uid() then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if p_expected_revision is null or v_current_revision <> p_expected_revision then
    return query select 'conflict'::text, v_current_revision, v_current_updated_at;
    return;
  end if;

  update public.projects
  set name = p_name,
      schema_version = p_schema_version,
      document_json = p_document,
      revision = revision + 1
      -- updated_at BU YERDA YOZILMAYDI — trigger majburan boshqaradi.
  where id = p_id;

  select revision, updated_at into v_current_revision, v_current_updated_at
    from public.projects where id = p_id;

  return query select 'updated'::text, v_current_revision, v_current_updated_at;
end;
$$;

-- ================= 4. NOMLASH RPC — xuddi shu himoyalangan yo'l (talab #3) =================
-- Rename ALOHIDA, nazoratsiz UPDATE orqali EMAS — u ham trigger orqali
-- revision/updated_at semantikasini saqlaydi.
create or replace function public.rename_project(
  p_id uuid,
  p_name text
) returns table(result text, new_revision bigint, server_updated_at timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_current_revision bigint;
begin
  if auth.uid() is null then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  select owner_id, revision into v_owner_id, v_current_revision
    from public.projects where id = p_id for update;

  if v_owner_id is null then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
    return;
  end if;
  if v_owner_id <> auth.uid() then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  update public.projects set name = p_name, revision = revision + 1 where id = p_id;

  select revision into v_current_revision from public.projects where id = p_id;
  return query select 'updated'::text, v_current_revision,
    (select updated_at from public.projects where id = p_id);
end;
$$;

-- ================= 5. GRANT / REVOKE (talab #2) =================
revoke all on function public.save_project_with_conflict_check(uuid, text, text, jsonb, bigint) from public;
revoke all on function public.save_project_with_conflict_check(uuid, text, text, jsonb, bigint) from anon;
grant execute on function public.save_project_with_conflict_check(uuid, text, text, jsonb, bigint) to authenticated;

revoke all on function public.rename_project(uuid, text) from public;
revoke all on function public.rename_project(uuid, text) from anon;
grant execute on function public.rename_project(uuid, text) to authenticated;

revoke all on public.projects from public;
revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated;
-- Eslatma: UPDATE huquqi RPC'ning SECURITY INVOKER sifatida ishlashi uchun
-- ZARUR (yuqoridagi tushuntirishga qarang) — lekin yuqoridagi trigger
-- revision/updated_at semantikasini har qanday chaqiruv yo'lida kafolatlaydi.

revoke all on public.project_assets from public;
revoke all on public.project_assets from anon;
grant select, insert, update, delete on public.project_assets to authenticated;

-- ================= 6. ROW LEVEL SECURITY (talab #5) =================
alter table public.projects enable row level security;
alter table public.project_assets enable row level security;

drop policy if exists "select_own_projects" on public.projects;
create policy "select_own_projects" on public.projects
  for select using (owner_id = auth.uid());

drop policy if exists "insert_own_projects" on public.projects;
create policy "insert_own_projects" on public.projects
  for insert with check (owner_id = auth.uid());

drop policy if exists "update_own_projects" on public.projects;
create policy "update_own_projects" on public.projects
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "delete_own_projects" on public.projects;
create policy "delete_own_projects" on public.projects
  for delete using (owner_id = auth.uid());

-- project_assets: owner_id TEKSHIRUVI YETARLI EMAS — project_id ham
-- HAQIQATDA shu foydalanuvchiniki ekanligi tasdiqlanishi SHART (talab #5,
-- "boshqa foydalanuvchi loyihasiga asset biriktirish"ning oldini olish).
drop policy if exists "select_own_assets" on public.project_assets;
create policy "select_own_assets" on public.project_assets
  for select using (
    owner_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "insert_own_assets" on public.project_assets;
create policy "insert_own_assets" on public.project_assets
  for insert with check (
    owner_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "update_own_assets" on public.project_assets;
create policy "update_own_assets" on public.project_assets
  for update using (
    owner_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    owner_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "delete_own_assets" on public.project_assets;
create policy "delete_own_assets" on public.project_assets
  for delete using (
    owner_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

-- ================= 7. STORAGE BUCKET (talab #6) =================
-- QO'LDA yarating: Supabase Dashboard > Storage > New bucket
--   Nomi: project-assets   |   Public: OFF (albatta yopiq)
-- Yo'l konvensiyasi: {owner_id}/{project_id}/{assetId}
-- Har bir siyosat: (1) birinchi papka = auth.uid(), (2) ikkinchi papka
-- (project_id) HAQIQATDA shu foydalanuvchiniki ekanligini tekshiradi.

drop policy if exists "select_own_asset_files" on storage.objects;
create policy "select_own_asset_files" on storage.objects
  for select using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2] and p.owner_id = auth.uid()
    )
  );

drop policy if exists "insert_own_asset_files" on storage.objects;
create policy "insert_own_asset_files" on storage.objects
  for insert with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2] and p.owner_id = auth.uid()
    )
  );

drop policy if exists "update_own_asset_files" on storage.objects;
create policy "update_own_asset_files" on storage.objects
  for update using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2] and p.owner_id = auth.uid()
    )
  );

drop policy if exists "delete_own_asset_files" on storage.objects;
create policy "delete_own_asset_files" on storage.objects
  for delete using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
