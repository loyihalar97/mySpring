/* =========================================================================
   storage/asset-storage.js
   ---------------------------------------------------------------------
   Binary Asset fayllar (rasm dataURL) uchun ATAYLAB Project JSON'dan
   alohida namespace (OMS Bo'lim 11: "og'ir binary kontent alohida
   saqlanadi").
   ========================================================================= */

import { createStorageAdapter } from './storage-adapter.js';

export const AssetStorage = createStorageAdapter('assets');
