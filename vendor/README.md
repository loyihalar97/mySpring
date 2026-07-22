# vendor/

Bu papkadagi `supabase-js.bundle.mjs` — **avtomatik generatsiya qilingan** fayl.

**Uni QO'LDA TAHRIRLAMANG.**

Qayta generatsiya qilish uchun:

```bash
npm install
npm run vendor:supabase
```

Bu buyruq `package.json`da **aniq pin qilingan** versiyadagi
(`@supabase/supabase-js@2.110.8`) npm paketini `node_modules/`dan olib,
`esbuild` orqali bitta, hech qanday tashqi bog'liqlikka muhtoj bo'lmagan
ESM faylga birlashtiradi. Natija **reproducible** — bir xil
`package.json` + bir xil `package-lock.json` bilan har doim bir xil
mazmunli fayl hosil bo'ladi.

Versiyani yangilash kerak bo'lsa — `package.json`dagi versiyani
o'zgartiring, `npm install`, so'ng shu buyruqni qayta ishga tushiring.
