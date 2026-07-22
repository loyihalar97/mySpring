/* =========================================================================
   storage/auth.js
   ---------------------------------------------------------------------
   Supabase Auth ustidagi yagona qatlam. Boshqa hech qanday modul
   supabase.auth'ga to'g'ridan-to'g'ri murojaat qilmaydi.
   ========================================================================= */

import { supabase, isSupabaseConfigured } from './supabase-client.js';
import { notifyStateChange } from '../core/state.js';

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function isCloudAvailable() {
  return isSupabaseConfigured && !!currentUser;
}

export async function initAuth() {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  currentUser = data && data.session ? data.session.user : null;

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null;
    notifyStateChange({ type: 'auth-changed', user: currentUser });
  });

  return currentUser;
}

export async function signInWithPassword(email, password) {
  if (!isSupabaseConfigured) return { error: 'Supabase sozlanmagan' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  currentUser = data.user;
  notifyStateChange({ type: 'auth-changed', user: currentUser });
  return { user: currentUser };
}

export async function signUpWithPassword(email, password) {
  if (!isSupabaseConfigured) return { error: 'Supabase sozlanmagan' };
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  currentUser = data.user;
  notifyStateChange({ type: 'auth-changed', user: currentUser });
  return { user: currentUser };
}

export async function signOut() {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
  currentUser = null;
  notifyStateChange({ type: 'auth-changed', user: null });
}
