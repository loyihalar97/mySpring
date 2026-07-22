-- =========================================================================
-- Tekshiruv so'rovlari — schema.sql ishga tushirilgandan keyin, Supabase
-- SQL Editor'ida QO'LDA ishga tushiring va natijalarni tekshiring.
-- =========================================================================

-- 1) Jadvallar va RLS yoqilganini tekshirish
select relname, relrowsecurity
from pg_class
where relname in ('projects', 'project_assets');
-- Kutilgan: ikkalasida ham relrowsecurity = true

-- 2) Barcha siyosatlar ro'yxati (8 ta bo'lishi kerak: projects uchun 4, assets uchun 4)
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, cmd;

-- 3) Storage siyosatlari (4 ta: select/insert/update/delete)
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by cmd;

-- 4) Funksiya huquqlari — anon'da BO'LMASLIGI, authenticated'da BO'LISHI kerak
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_name in ('save_project_with_conflict_check', 'rename_project')
order by routine_name, grantee;

-- 5) Trigger mavjudligini tekshirish
select tgname, tgrelid::regclass, tgenabled
from pg_trigger
where tgname = 'trg_enforce_project_update_invariants';

-- 6) Funksiya SECURITY turi — INVOKER bo'lishi kerak (DEFINER emas)
select proname, prosecdef
from pg_proc
where proname in ('save_project_with_conflict_check', 'rename_project', 'enforce_project_update_invariants');
-- Kutilgan: barchasida prosecdef = false (ya'ni SECURITY INVOKER)

-- 7) Trigger invariantini qo'lda sinash (o'zingizning test loyihangiz bilan)
-- Avval haqiqiy foydalanuvchi sifatida (Supabase Auth orqali) autentifikatsiya
-- qilingan holda quyidagilarni RPC orqali chaqiring (to'g'ridan-to'g'ri SQL
-- emas, chunki auth.uid() faqat autentifikatsiyalangan so'rovda ishlaydi):
--   select * from save_project_with_conflict_check(
--     gen_random_uuid(), 'Test', '1.3.0', '{}'::jsonb, null
--   );
-- Kutilgan natija: result = 'created', new_revision = 1
