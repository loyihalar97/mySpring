-- =========================================================================
-- mySpring Suite — Sprint R1.2 (2-tuzatish) — Cloud Persistence (Supabase)
-- IDEMPOTENT — xavfsiz qayta-qayta ishga tushirish mumkin.
--
-- ARXITEKTURA QARORI (foydalanuvchi tanqidiga javoban):
-- Avvalgi versiyada BEFORE UPDATE trigger "revision aynan +1" invariantini
-- tekshirar edi, LEKIN bu mijozning `expected_revision`sini HAQIQIY joriy
-- revision bilan solishtirmasdi. To'g'ridan-to'g'ri
-- `SET revision = revision + 1` chaqiruvi ham triggerdan muvaffaqiyatli
-- o'tar edi — bu esa optimistik concurrency'ning o'zini butunlay chetlab
-- o'tishga imkon berardi (eskirgan mijoz o'z eski nusxasini yangi
-- versiya ustiga jimgina yozib qo'yishi mumkin edi).
--
-- YECHIM: SECURITY INVOKER o'rniga SECURITY DEFINER'ga o'tildi. Endi
-- `authenticated` roliga jadvalda HECH QANDAY to'g'ridan-to'g'ri INSERT/
-- UPDATE/DELETE huquqi berilmaydi — FAQAT SELECT (RLS orqali filtrlangan).
-- Barcha yozish amallari — optimistik concurrency tekshiruvini BITTA
-- atomik `UPDATE ... WHERE ... AND revision = expected RETURNING` orqali
-- amalga oshiruvchi, qattiq nazorat qilinadigan RPC funksiyalari orqali.
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
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at timestamptz not null default now()
);
create index if not exists idx_project_assets_project_id on public.project_assets(project_id);
create index if not exists idx_project_assets_owner_id on public.project_assets(owner_id);

-- ================= 2. HIMOYA QATLAMI (defense in depth, ENDI ENFORCEMENT EMAS) =================
-- MUHIM: bu trigger optimistik concurrency'ni ENFORCE QILMAYDI (buni pastdagi
-- RPC'ning atomik UPDATE...WHERE...RETURNING shartlari qiladi). Trigger —
-- faqat qo'shimcha xavfsizlik qatlami: hattoki RPC ichidagi (yoki
-- kelajakda xato bilan berilgan) har qanday UPDATE ham quyidagi
-- invariantlarni buzolmasligini kafolatlaydi.
create or replace function public.enforce_project_update_invariants()
returns trigger
language plpgsql
set search_path = pg_catalog, public
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

-- ================= 3. SAQLASH RPC — YAGONA ATOMIK UPDATE...RETURNING =================
-- Optimistik concurrency ENDI shu yerda, bitta SQL bayonotida enforce
-- qilinadi: WHERE shart (id + owner_id + revision = expected) va UPDATE —
-- BITTA, bo'linmas amal. Ikkita parallel so'rov bir xil expected_revision
-- bilan kelsa — Postgres'ning qator qulfi ularni serializatsiya qiladi:
-- birinchisi WHERE shartiga mos keladi va yangilanadi, ikkinchisi (endi
-- revision allaqachon o'zgargan bo'lgani uchun) WHERE shartiga mos
-- kelmaydi — `found` false, natija 'conflict'.
create or replace function public.save_project_with_conflict_check(
  p_id uuid,
  p_name text,
  p_schema_version text,
  p_document jsonb,
  p_expected_revision bigint
) returns table(result text, new_revision bigint, server_updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_row_exists boolean;
  v_upd_revision bigint;
  v_upd_updated_at timestamptz;
begin
  if v_uid is null then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  select exists(select 1 from public.projects where id = p_id) into v_row_exists;

  if not v_row_exists then
    begin
      insert into public.projects (id, owner_id, name, schema_version, document_json, revision)
      values (p_id, v_uid, p_name, p_schema_version, p_document, 1);
      return query select 'created'::text, 1::bigint, now();
      return;
    exception when unique_violation then
      -- Ikkita "birinchi saqlash" so'rovi bir-birini bosib o'tdi — kutilmagan
      -- xato TASHLANMAYDI, pastdagi shartli-yangilash yo'liga o'tiladi
      -- (u yerda ikkinchisi to'g'ri ravishda 'conflict' oladi).
      null;
    end;
  end if;

  -- YAGONA ATOMIK AMAL: tekshiruv va yangilash bir SQL bayonotida.
  update public.projects
  set name = p_name,
      schema_version = p_schema_version,
      document_json = p_document,
      revision = revision + 1
  where id = p_id
    and owner_id = v_uid
    and revision = p_expected_revision
  returning revision, updated_at into v_upd_revision, v_upd_updated_at;

  if found then
    return query select 'updated'::text, v_upd_revision, v_upd_updated_at;
    return;
  end if;

  -- Qator yangilanmadi — sababni ANIQLAYMIZ (mashina-o'qiy oladigan natija uchun).
  select owner_id into v_owner_id from public.projects where id = p_id;

  if v_owner_id is null then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
  elsif v_owner_id <> v_uid then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
  else
    return query select 'conflict'::text,
      (select revision from public.projects where id = p_id),
      (select updated_at from public.projects where id = p_id);
  end if;
end;
$$;

-- ================= 4. NOMLASH RPC — xuddi shu atomik naqsh, revision bilan =================
create or replace function public.rename_project(
  p_id uuid,
  p_name text,
  p_expected_revision bigint
) returns table(result text, new_revision bigint, server_updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_upd_revision bigint;
  v_upd_updated_at timestamptz;
begin
  if v_uid is null then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  update public.projects
  set name = p_name, revision = revision + 1
  where id = p_id and owner_id = v_uid and revision = p_expected_revision
  returning revision, updated_at into v_upd_revision, v_upd_updated_at;

  if found then
    return query select 'updated'::text, v_upd_revision, v_upd_updated_at;
    return;
  end if;

  select owner_id into v_owner_id from public.projects where id = p_id;
  if v_owner_id is null then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
  elsif v_owner_id <> v_uid then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
  else
    return query select 'conflict'::text,
      (select revision from public.projects where id = p_id),
      (select updated_at from public.projects where id = p_id);
  end if;
end;
$$;

-- ================= 5. O'CHIRISH RPC =================
create or replace function public.delete_project(
  p_id uuid,
  p_expected_revision bigint default null
) returns table(result text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_current_revision bigint;
begin
  if v_uid is null then
    return query select 'forbidden'::text;
    return;
  end if;

  select owner_id, revision into v_owner_id, v_current_revision
    from public.projects where id = p_id;

  if v_owner_id is null then
    return query select 'not_found'::text;
    return;
  end if;
  if v_owner_id <> v_uid then
    return query select 'forbidden'::text;
    return;
  end if;
  if p_expected_revision is not null and v_current_revision <> p_expected_revision then
    return query select 'conflict'::text;
    return;
  end if;

  delete from public.projects where id = p_id and owner_id = v_uid;
  -- project_assets qatorlari `on delete cascade` orqali avtomatik o'chadi.
  return query select 'deleted'::text;
end;
$$;

-- ================= 6. GRANT / REVOKE — TALAB QILINGAN QAT'IY MODEL =================
-- Funksiyalar: faqat authenticated bajara oladi.
revoke all on function public.save_project_with_conflict_check(uuid, text, text, jsonb, bigint) from public, anon;
grant execute on function public.save_project_with_conflict_check(uuid, text, text, jsonb, bigint) to authenticated;

revoke all on function public.rename_project(uuid, text, bigint) from public, anon;
grant execute on function public.rename_project(uuid, text, bigint) to authenticated;

revoke all on function public.delete_project(uuid, bigint) from public, anon;
grant execute on function public.delete_project(uuid, bigint) to authenticated;

-- Jadvallar: authenticated FAQAT SELECT huquqiga ega (RLS bilan
-- filtrlangan) — HECH QANDAY to'g'ridan-to'g'ri INSERT/UPDATE/DELETE
-- huquqi YO'Q. Barcha yozishlar yuqoridagi SECURITY DEFINER RPC'lar
-- orqali, ular FUNKSIYA EGASI (odatda `postgres`) huquqlari bilan
-- ishlaydi — shuning uchun `authenticated`ga to'g'ridan-to'g'ri
-- UPDATE/INSERT/DELETE berish SHART EMAS.
revoke all on public.projects from public, anon, authenticated;
grant select on public.projects to authenticated;

revoke all on public.project_assets from public, anon, authenticated;
grant select on public.project_assets to authenticated;
-- Eslatma: asset yozuvlari ham (kelajakda) SECURITY DEFINER RPC orqali
-- boshqarilishi tavsiya etiladi; hozircha Storage darajasidagi siyosatlar
-- (pastda) asosiy himoya chizig'i hisoblanadi.

-- ================= 7. ROW LEVEL SECURITY (faqat SELECT uchun amalda) =================
alter table public.projects enable row level security;
alter table public.project_assets enable row level security;

drop policy if exists "select_own_projects" on public.projects;
create policy "select_own_projects" on public.projects
  for select using (owner_id = auth.uid());

-- Quyidagi insert/update/delete siyosatlari — QO'SHIMCHA himoya qatlami
-- (defense in depth). Amalda ularga yetib bo'lmaydi, chunki `authenticated`
-- rolida bu amallar uchun GRANT umuman yo'q (yuqoriga qarang). Agar
-- kelajakda kimdir noto'g'ri GRANT qo'shib qo'ysa ham, bu siyosatlar
-- yagona himoya chizig'i bo'lib qolmaydi.
drop policy if exists "insert_own_projects" on public.projects;
create policy "insert_own_projects" on public.projects
  for insert with check (owner_id = auth.uid());

drop policy if exists "update_own_projects" on public.projects;
create policy "update_own_projects" on public.projects
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "delete_own_projects" on public.projects;
create policy "delete_own_projects" on public.projects
  for delete using (owner_id = auth.uid());

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

-- ================= 8. STORAGE BUCKET =================
-- QO'LDA yarating: Supabase Dashboard > Storage > New bucket
--   Nomi: project-assets   |   Public: OFF
-- Yo'l konvensiyasi: {owner_id}/{project_id}/{assetId}

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
    bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text
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
    bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text
  );
