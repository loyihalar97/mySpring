/* =========================================================================
   storage/supabase-client.js
   ---------------------------------------------------------------------
   Supabase klientini yaratadigan YAGONA joy.

   Sprint R1.2 tuzatishi (talab #8): esm.sh CDN'ga RUNTIME bog'liqligi
   OLIB TASHLANDI. @supabase/supabase-js rasmiy npm paketi sifatida
   o'rnatiladi (`npm install`), so'ng BIR MARTALIK "vendoring" buyrug'i
   (`npm run vendor:supabase`, esbuild orqali) uni bitta, hech qanday
   tashqi bare-specifier importiga muhtoj bo'lmagan ESM faylga
   birlashtiradi (`vendor/supabase-js.bundle.mjs`). Bu — doimiy bundler
   emas, bitta martalik "vendoring" qadami; ilovaning o'zi hamon oddiy,
   bandlersiz native ES modules orqali ishlaydi.

   Sabab: @supabase/supabase-js'ning o'z ESM build'i ICHKI paketlarga
   (@supabase/auth-js, postgrest-js, realtime-js, storage-js, functions-js
   va boshqalar) bare-specifier import qiladi — bularni qo'lda import map
   orqali xaritalash mo'rt va xato-moyil (avtomatik tekshiruv buni
   tasdiqladi). Vendoring — bundan qochishning eng ishonchli yo'li.

   XAVFSIZLIK: bu yerda faqat PUBLIC ANON KEY ishlatiladi (config
   modulidan). Service-role kalit HECH QACHON frontend kodiga qo'yilmaydi.
   ========================================================================= */

import { createClient } from '../../vendor/supabase-js.bundle.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/supabase.config.js';

export const isSupabaseConfigured =
  SUPABASE_URL !== 'https://YOUR-PROJECT-REF.supabase.co' &&
  SUPABASE_ANON_KEY !== 'YOUR-PUBLIC-ANON-KEY' &&
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const ASSET_BUCKET = 'project-assets';
