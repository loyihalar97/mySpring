/* =========================================================================
   storage/supabase-adapter.js
   ---------------------------------------------------------------------
   Butun ilovada Supabase'ga to'g'ridan-to'g'ri murojaat qilinadigan
   YAGONA modul.

   Sprint R1.2 tuzatishi (talab #3): `renameProject` endi to'g'ridan-to'g'ri
   `.update()` chaqirmaydi — nazoratsiz, revision-cheklovisiz UPDATE yo'li
   BUTUNLAY OLIB TASHLANDI. Barcha yozish amallari — `save_project_with_
   conflict_check` YOKI `rename_project` RPC'lari orqali, ikkalasi ham
   database trigger orqali revision/updated_at semantikasini kafolatlaydi.
   ========================================================================= */

import { supabase, ASSET_BUCKET } from './supabase-client.js';
import { getCurrentUser } from './auth.js';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_ASSET_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — schema.sql'dagi CHECK bilan mos
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,schema_version,created_at,updated_at,revision')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data.map(row => ({
    id: row.id,
    name: row.name,
    schemaVersion: row.schema_version,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    revision: row.revision,
  }));
}

export async function getProject(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('document_json,revision,updated_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    project: data.document_json,
    revision: data.revision,
    updatedAt: new Date(data.updated_at).getTime(),
  };
}

// Natija: { resultCode: 'created'|'updated'|'conflict'|'forbidden'|'not_found',
//           success, revision, serverUpdatedAt }
function normalizeRpcRow(row) {
  const resultCode = row.result;
  return {
    resultCode,
    success: resultCode === 'created' || resultCode === 'updated',
    revision: row.new_revision,
    serverUpdatedAt: row.server_updated_at ? new Date(row.server_updated_at).getTime() : null,
  };
}

export async function saveProject(project, expectedRevision) {
  const { data, error } = await supabase.rpc('save_project_with_conflict_check', {
    p_id: project.id,
    p_name: project.name,
    p_schema_version: project.schemaVersion,
    p_document: project,
    p_expected_revision: expectedRevision ?? null,
  });
  if (error) throw error;
  return normalizeRpcRow(data[0]);
}

// Sprint R1.2 tuzatishi: nazoratsiz .update() O'RNIGA himoyalangan RPC.
export async function renameProject(projectId, newName) {
  const { data, error } = await supabase.rpc('rename_project', {
    p_id: projectId,
    p_name: newName,
  });
  if (error) throw error;
  return normalizeRpcRow(data[0]);
}

export async function deleteProject(projectId) {
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) throw error;
}

/* ---------- Assets (talab #7: fayl cheklovlari + rollback) ---------- */

export async function uploadAsset(projectId, assetId, dataUrl, mimeType) {
  const user = getCurrentUser();
  if (!user) throw new Error("Login qilinmagan \u2014 asset yuklab bo'lmaydi");

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Ruxsat etilmagan fayl turi: ${mimeType}`);
  }
  if (!UUID_RE.test(assetId)) {
    throw new Error("Noto'g'ri assetId format (UUID bo'lishi kerak)");
  }

  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (blob.size > MAX_ASSET_SIZE_BYTES) {
    throw new Error(`Fayl hajmi ${MAX_ASSET_SIZE_BYTES / 1024 / 1024}MB dan katta`);
  }

  const path = `${user.id}/${projectId}/${assetId}`;

  // 1) Avval faylni yuklaymiz.
  const { error: upErr } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: true });
  if (upErr) throw upErr;

  // 2) Keyin metadata yozuvini qo'shamiz. Agar bu MUVAFFAQIYATSIZ bo'lsa —
  // KOMPENSATSIYA: endigina yuklangan faylni DARHOL o'chiramiz, shunda
  // Storage'da metadata'siz "yetim" fayl qolib ketmaydi (talab #7:
  // qisman bajarilgan amal uchun rollback strategiyasi).
  const { error: dbErr } = await supabase.from('project_assets').upsert({
    id: assetId,
    project_id: projectId,
    owner_id: user.id,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: blob.size,
  });
  if (dbErr) {
    try {
      await supabase.storage.from(ASSET_BUCKET).remove([path]);
    } catch (rollbackErr) {
      console.error('[Asset Upload] Rollback ham muvaffaqiyatsiz \u2014 qo\u2018lda tozalash talab qilinadi:', path, rollbackErr);
    }
    throw dbErr;
  }

  return path;
}

// Vaqtinchalik (1 soatlik) signed URL qaytaradi — bucket PRIVATE.
export async function getAsset(assetId) {
  const { data, error } = await supabase
    .from('project_assets')
    .select('storage_path')
    .eq('id', assetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: signed, error: sErr } = await supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(data.storage_path, 3600);
  if (sErr) throw sErr;
  return signed.signedUrl;
}

export async function deleteAsset(assetId) {
  const { data } = await supabase
    .from('project_assets')
    .select('storage_path')
    .eq('id', assetId)
    .maybeSingle();
  if (data) {
    // Metadata YOZUVINI birinchi o'chiramiz — agar Storage'dan o'chirish
    // keyinroq muvaffaqiyatsiz bo'lsa, hech bo'lmasa endi hech kim uni
    // ko'rmaydi (RLS/ilova nuqtai nazaridan "yo'q"), fayl esa keyinroq
    // qo'lda yoki davriy tozalash orqali olib tashlanishi mumkin.
    await supabase.from('project_assets').delete().eq('id', assetId);
    try {
      await supabase.storage.from(ASSET_BUCKET).remove([data.storage_path]);
    } catch (err) {
      console.error('[Asset Delete] Storage\'dan o\u2018chirishda xato \u2014 keyinroq tozalash kerak:', data.storage_path, err);
    }
  }
}
