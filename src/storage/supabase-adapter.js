/* =========================================================================
   storage/supabase-adapter.js
   ---------------------------------------------------------------------
   Butun ilovada Supabase'ga to'g'ridan-to'g'ri murojaat qilinadigan
   YAGONA modul.

   Sprint R1.2 (2-tuzatish): barcha yozish amallari (save/rename/delete)
   endi SECURITY DEFINER RPC'lar orqali, bittа atomik UPDATE...WHERE...
   RETURNING naqshi bilan — bu haqiqiy optimistik concurrency'ni
   kafolatlaydi (avvalgi trigger-asoslangan yondashuv buni to'liq
   kafolatlamas edi). `renameProject` endi `expectedRevision` talab
   qiladi. `deleteProject` endi to'g'ridan-to'g'ri `.delete()` emas,
   `delete_project` RPC orqali.
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

// Sprint R1.2 (2-tuzatish): rename ENDI expectedRevision talab qiladi —
// u ham xuddi content-save bilan bir xil optimistik concurrency
// tizimida ishtirok etadi (talab: "Rename must also use a secured RPC
// with expected revision").
export async function renameProject(projectId, newName, expectedRevision) {
  const { data, error } = await supabase.rpc('rename_project', {
    p_id: projectId,
    p_name: newName,
    p_expected_revision: expectedRevision ?? null,
  });
  if (error) throw error;
  return normalizeRpcRow(data[0]);
}

// Sprint R1.2 (2-tuzatish): to'g'ridan-to'g'ri .delete() O'RNIGA himoyalangan RPC.
export async function deleteProject(projectId, expectedRevision) {
  const { data, error } = await supabase.rpc('delete_project', {
    p_id: projectId,
    p_expected_revision: expectedRevision ?? null,
  });
  if (error) throw error;
  const row = data[0];
  return { resultCode: row.result, success: row.result === 'deleted' };
}

/* ---------- Assets (fayl cheklovlari + rollback) ---------- */

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

  const { error: upErr } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: true });
  if (upErr) throw upErr;

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
    await supabase.from('project_assets').delete().eq('id', assetId);
    try {
      await supabase.storage.from(ASSET_BUCKET).remove([data.storage_path]);
    } catch (err) {
      console.error('[Asset Delete] Storage\'dan o\u2018chirishda xato \u2014 keyinroq tozalash kerak:', data.storage_path, err);
    }
  }
}
