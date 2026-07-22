-- =========================================================================
-- Tekshiruv so'rovlari va 8 ta talab qilingan test.
-- schema.sql ishga tushirilgandan KEYIN, Supabase SQL Editor'ida QO'LDA
-- ishga tushiring.
--
-- auth.uid()ni SQL Editor'da simulyatsiya qilish uchun Supabase'ning
-- standart texnikasi ishlatiladi: `set local role authenticated` +
-- `set local request.jwt.claim.sub`. Bu — haqiqiy foydalanuvchi
-- autentifikatsiyasini emulyatsiya qiladi, xavfsiz va faqat joriy
-- tranzaksiya doirasida amal qiladi.
-- =========================================================================

-- =========================================================================
-- A) STRUKTURAVIY TEKSHIRUVLAR
-- =========================================================================

-- A1) RLS yoqilganini tekshirish
select relname, relrowsecurity from pg_class where relname in ('projects','project_assets');
-- Kutilgan: ikkalasida ham true

-- A2) Funksiyalar SECURITY DEFINER ekanligini tekshirish
select proname, prosecdef, proconfig
from pg_proc
where proname in ('save_project_with_conflict_check','rename_project','delete_project');
-- Kutilgan: barchasida prosecdef = true, proconfig ichida 'search_path=pg_catalog, public'

-- A3) `authenticated` roli jadvalda FAQAT SELECT huquqiga ega ekanligini tekshirish
select grantee, privilege_type
from information_schema.role_table_grants
where table_name in ('projects','project_assets') and grantee = 'authenticated';
-- Kutilgan: FAQAT 'SELECT' qatori (INSERT/UPDATE/DELETE YO'Q)

-- A4) `anon` roli funksiyalarga umuman huquqi yo'qligini tekshirish
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_name in ('save_project_with_conflict_check','rename_project','delete_project');
-- Kutilgan: faqat grantee = 'authenticated' qatorlari, 'anon' umuman ko'rinmasligi kerak


-- =========================================================================
-- B) 8 TA TALAB QILINGAN TEST
-- =========================================================================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---- TEST 1 & 2: Ikkita "parallel" saqlash, revision 5'dan ----
-- (Haqiqiy PARALLEL so'rovlarni bitta ketma-ket SQL skriptida to'liq
-- simulyatsiya qilib bo'lmaydi — lekin bitta atomik UPDATE...WHERE...
-- RETURNING bayonoti Postgres qator qulfi orqali ikkita HAQIQIY parallel
-- chaqiruvni avtomatik serializatsiya qiladi: birinchisi WHERE shartiga
-- mos keladi va yutadi, ikkinchisi endi revision o'zgargani uchun mos
-- kelmaydi. Bu — MVCC/qator qulfining o'zi kafolatlaydigan xususiyat,
-- ilova kodiga bog'liq emas. Quyida WHERE shartining to'g'ri ishlashini
-- ketma-ket chaqiruv orqali tasdiqlaymiz.)

select * from public.save_project_with_conflict_check(
  '33333333-3333-3333-3333-333333333333', 'Test Project', '1.3.0', '{"slides":[]}'::jsonb, null
);
-- Kutilgan: result='created', new_revision=1

select * from public.save_project_with_conflict_check('33333333-3333-3333-3333-333333333333','v2','1.3.0','{}'::jsonb, 1);
select * from public.save_project_with_conflict_check('33333333-3333-3333-3333-333333333333','v3','1.3.0','{}'::jsonb, 2);
select * from public.save_project_with_conflict_check('33333333-3333-3333-3333-333333333333','v4','1.3.0','{}'::jsonb, 3);
select * from public.save_project_with_conflict_check('33333333-3333-3333-3333-333333333333','v5','1.3.0','{}'::jsonb, 4);
-- Oxirgisidan keyin: revision = 5

select * from public.save_project_with_conflict_check('33333333-3333-3333-3333-333333333333','Client A save','1.3.0','{}'::jsonb, 5);
-- KUTILGAN (TEST 1): result='updated', new_revision=6

select * from public.save_project_with_conflict_check('33333333-3333-3333-3333-333333333333','Client B save (stale)','1.3.0','{}'::jsonb, 5);
-- KUTILGAN (TEST 1 & TEST 2): result='conflict', new_revision=6
-- Client B'ning eskirgan (revision=5 deb hisoblagan, aslida 6) nusxasi
-- jimgina yozib yuborilmadi.

-- ---- TEST 3: To'g'ridan-to'g'ri UPDATE rad etilishi ----
-- `authenticated` roli endi jadvalda hech qanday UPDATE huquqiga ega
-- emas (faqat SELECT), shuning uchun quyidagi bayonot XATO bilan
-- muvaffaqiyatsiz bo'lishi SHART:
update public.projects set document_json = '{"hacked":true}'::jsonb where id = '33333333-3333-3333-3333-333333333333';
-- KUTILGAN: ERROR: permission denied for table projects

-- ---- TEST 4: owner_id'ni o'zgartirishga urinish ----
-- Yuqoridagi bilan bir xil sabab bilan — UPDATE huquqi umuman yo'q:
update public.projects set owner_id = '22222222-2222-2222-2222-222222222222' where id = '33333333-3333-3333-3333-333333333333';
-- KUTILGAN: ERROR: permission denied for table projects

-- ---- TEST 6: updated_at doim database tomonidan generatsiya qilinishini tekshirish ----
select updated_at from public.projects where id = '33333333-3333-3333-3333-333333333333';
-- Yuqoridagi RPC chaqiruvlaridan keyin bu qiymat HAR SAFAR now()ga yaqin
-- bo'lishi kerak (mijoz hech qachon o'zi timestamp yubormagan — RPC'da
-- bunday parametr ham yo'q).

-- ---- TEST 7: Rename ham bir xil revision-konflikt tizimida ishtirok etadi ----
select * from public.rename_project('33333333-3333-3333-3333-333333333333', 'Renamed OK', 6);
-- KUTILGAN: result='updated', new_revision=7

select * from public.rename_project('33333333-3333-3333-3333-333333333333', 'Renamed Stale', 6);
-- KUTILGAN: result='conflict' (chunki haqiqiy revision endi 7, 6 emas)

rollback; -- barcha test ma'lumotlarini bekor qilish


-- ---- TEST 8: RPC `authenticated` uchun ishlaydi, `anon` uchun rad etiladi ----
begin;
set local role anon;
select * from public.save_project_with_conflict_check(
  '44444444-4444-4444-4444-444444444444', 'Anon attempt', '1.3.0', '{}'::jsonb, null
);
-- KUTILGAN: ERROR: permission denied for function save_project_with_conflict_check
rollback;


-- =========================================================================
-- C) IKKI-FOYDALANUVCHI XAVFSIZLIK TESTI (TEST 5) — SQL orqali simulyatsiya
-- =========================================================================
-- Eslatma: quyidagi User A/User B UUID'lari `auth.users`da HAQIQATDA
-- mavjud bo'lishi kerak (haqiqiy ro'yxatdan o'tish orqali) — aks holda
-- `projects.owner_id`ning `auth.users(id)`ga bo'lgan FOREIGN KEY cheklovi
-- INSERT'ni rad etadi. Haqiqiy ikkita test hisobini yarating va
-- UUID'larini shu yerga qo'ying.

-- User A sifatida loyiha yaratish:
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<USER_A_HAQIQIY_UUID>';
select * from public.save_project_with_conflict_check(
  '55555555-5555-5555-5555-555555555555', 'User A Project', '1.3.0', '{}'::jsonb, null
);
commit;

-- User B sifatida User A'ning loyihasiga kirishga urinish:
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<USER_B_HAQIQIY_UUID>';

select * from public.projects where id = '55555555-5555-5555-5555-555555555555';
-- KUTILGAN: 0 qator (RLS SELECT siyosati yashiradi)

select * from public.rename_project('55555555-5555-5555-5555-555555555555', 'Hijacked', 1);
-- KUTILGAN: result='forbidden'

select * from public.save_project_with_conflict_check('55555555-5555-5555-5555-555555555555','Hijacked','1.3.0','{}'::jsonb, 1);
-- KUTILGAN: result='forbidden'

select * from public.delete_project('55555555-5555-5555-5555-555555555555', null);
-- KUTILGAN: result='forbidden'
rollback;

-- Tozalash (User A sifatida):
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<USER_A_HAQIQIY_UUID>';
select * from public.delete_project('55555555-5555-5555-5555-555555555555', null);
commit;
