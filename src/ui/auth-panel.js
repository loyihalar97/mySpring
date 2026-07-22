/* =========================================================================
   ui/auth-panel.js
   ---------------------------------------------------------------------
   Login/Logout, joriy foydalanuvchi ko'rsatkichi, Cloud Sync holati,
   oxirgi sinxronlangan vaqt, oflayn indikatori.
   ========================================================================= */

import { getCurrentUser, signInWithPassword, signUpWithPassword, signOut } from '../storage/auth.js';
import { getSyncStatus, resolveConflictKeepLocal, resolveConflictKeepCloud } from '../storage/project-storage.js';
import { isSupabaseConfigured } from '../storage/supabase-client.js';
import { showModal } from './modals.js';
import { toast } from './toast.js';

const SYNC_STATUS_LABELS = {
  'local-only': { text: '\u25cb Faqat lokal', color: 'var(--text-dim)' },
  'syncing': { text: '\u21bb Sinxronlanmoqda\u2026', color: '#5aa9ff' },
  'synced': { text: '\u2713 Sinxronlangan', color: 'var(--accent)' },
  'offline': { text: '\u26a0 Oflayn (navbatda)', color: '#f5c15c' },
  'conflict': { text: '\u26a0 Konflikt', color: 'var(--danger)' },
  'error': { text: '\u2715 Sinxronlash xatosi', color: 'var(--danger)' },
};

export function renderAuthPanel() {
  const container = document.getElementById('auth-panel');
  if (!container) return;

  if (!isSupabaseConfigured) {
    container.innerHTML = `<span class="mono" style="font-size:10px;color:var(--text-dim);" title="src/storage/supabase-client.js faylida sozlang">\u2601 Cloud sozlanmagan</span>`;
    return;
  }

  const user = getCurrentUser();
  const { status, lastSyncedAt, pendingConflict } = getSyncStatus();
  const statusInfo = SYNC_STATUS_LABELS[status] || SYNC_STATUS_LABELS['local-only'];

  container.innerHTML = '';

  const statusEl = document.createElement('span');
  statusEl.className = 'mono';
  statusEl.style.cssText = `font-size:10.5px; color:${statusInfo.color};`;
  statusEl.textContent = statusInfo.text;
  container.appendChild(statusEl);

  if (lastSyncedAt) {
    const lastSyncEl = document.createElement('span');
    lastSyncEl.className = 'mono';
    lastSyncEl.style.cssText = 'font-size:10px; color:var(--text-dim);';
    lastSyncEl.textContent = `(${new Date(lastSyncedAt).toLocaleTimeString('uz-UZ')})`;
    container.appendChild(lastSyncEl);
  }

  if (status === 'conflict' && pendingConflict) {
    const conflictBtn = document.createElement('button');
    conflictBtn.textContent = 'Konfliktni hal qilish';
    conflictBtn.style.cssText = 'background:var(--danger); border-color:var(--danger); color:#fff;';
    conflictBtn.addEventListener('click', () => showConflictModal(pendingConflict));
    container.appendChild(conflictBtn);
  }

  if (user) {
    const userEl = document.createElement('span');
    userEl.style.cssText = 'font-size:11.5px; color:var(--text-primary);';
    userEl.textContent = user.email;
    container.appendChild(userEl);

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Chiqish';
    logoutBtn.addEventListener('click', async () => {
      await signOut();
      toast('Tizimdan chiqdingiz');
    });
    container.appendChild(logoutBtn);
  } else {
    const loginBtn = document.createElement('button');
    loginBtn.className = 'primary';
    loginBtn.textContent = 'Kirish';
    loginBtn.addEventListener('click', showLoginModal);
    container.appendChild(loginBtn);
  }
}

function showConflictModal(conflict) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const serverTime = conflict.serverUpdatedAt ? new Date(conflict.serverUpdatedAt).toLocaleString('uz-UZ') : "noma'lum";
  modal.innerHTML = `
    <h3>\u26a0 Sinxronizatsiya konflikti</h3>
    <p style="font-size:12px; color:var(--text-dim); line-height:1.5; margin:0 0 14px 0;">
      Bulutda ushbu loyihaning sizniki bilan bir vaqtda o'zgargan, yangiroq versiyasi bor
      (bulutdagi oxirgi o'zgarish: ${serverTime}). Qaysi versiyani saqlab qolasiz?
    </p>
    <div class="row" style="justify-content:space-between;">
      <button id="conflict-keep-cloud">Bulut versiyasini olish</button>
      <button id="conflict-keep-local" class="primary">Mening versiyamni saqlash</button>
    </div>
  `;
  backdrop.classList.add('open');
  document.getElementById('conflict-keep-cloud').onclick = async () => {
    backdrop.classList.remove('open');
    await resolveConflictKeepCloud();
    toast('Bulut versiyasi qabul qilindi');
  };
  document.getElementById('conflict-keep-local').onclick = async () => {
    backdrop.classList.remove('open');
    await resolveConflictKeepLocal();
    toast('Sizning versiyangiz bulutga yozildi');
  };
}

function showLoginModal() {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>Cloud'ga kirish</h3>
    <input id="auth-email" type="email" placeholder="Email" />
    <input id="auth-password" type="password" placeholder="Parol" />
    <div class="row">
      <button id="auth-signup">Ro'yxatdan o'tish</button>
      <button id="auth-signin" class="primary">Kirish</button>
    </div>
  `;
  backdrop.classList.add('open');
  const emailInput = document.getElementById('auth-email');
  emailInput.focus();

  async function attempt(fn) {
    const email = emailInput.value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { toast('Email va parolni kiriting'); return; }
    const result = await fn(email, password);
    if (result.error) { toast('\u26a0 ' + result.error); return; }
    backdrop.classList.remove('open');
    toast('Muvaffaqiyatli kirdingiz \u2713');
  }

  document.getElementById('auth-signin').onclick = () => attempt(signInWithPassword);
  document.getElementById('auth-signup').onclick = () => attempt(signUpWithPassword);
}
