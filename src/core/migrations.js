/* =========================================================================
   core/migrations.js
   ---------------------------------------------------------------------
   State Hydration (storage/project-storage.js'dagi reloadProject) paytida
   ishlaydi — Command emas, chunki foydalanuvchi harakati emas. Har bir
   migratsiya funksiyasi FAQAT bitta versiyadan keyingisiga o'tadi.
   ========================================================================= */

import { DEFAULT_THEME_TOKENS, DEFAULT_COMPLETION_SETTINGS } from './object-model.js';
import { AppState } from './state.js';
import { uuid } from './object-model.js';

// 1.0.0 -> 1.1.0: zIndex qo'shiladi, shape ranglari token'ga o'tkaziladi.
export function migrate_1_0_0_to_1_1_0(project) {
  const themeTokens = { ...DEFAULT_THEME_TOKENS, ...(project.themeTokens || {}) };
  const slides = project.slides.map(slide => ({
    ...slide,
    elements: slide.elements.map((el, idx) => {
      const withZ = (typeof el.zIndex === 'number') ? el : { ...el, zIndex: idx };
      if (withZ.type === 'shape' && !withZ.fillToken && withZ.fill) {
        const patch = {};
        if (withZ.fill === DEFAULT_THEME_TOKENS['shape.primary.fill']) patch.fillToken = 'shape.primary.fill';
        if (withZ.stroke === DEFAULT_THEME_TOKENS['shape.primary.stroke']) patch.strokeToken = 'shape.primary.stroke';
        return { ...withZ, ...patch };
      }
      return withZ;
    })
  }));
  return { ...project, schemaVersion: '1.1.0', themeTokens, slides };
}

// 1.1.0 -> 1.2.0: strukturaviy jihatdan bo'sh (no-op) — Quiz element turi
// qo'shildi, eski loyihalarda quiz elementi yo'q.
export function migrate_1_1_0_to_1_2_0(project) {
  return { ...project, schemaVersion: '1.2.0' };
}

// 1.2.0 -> 1.3.0: Course Completion Settings qo'shiladi.
export function migrate_1_2_0_to_1_3_0(project) {
  return {
    ...project,
    schemaVersion: '1.3.0',
    completionSettings: project.completionSettings || { ...DEFAULT_COMPLETION_SETTINGS }
  };
}

export function migrateProject(rawProject) {
  let project = rawProject;
  const fromVersion = project.schemaVersion || '1.0.0';
  if (!project.schemaVersion || project.schemaVersion === '1.0.0') {
    project = migrate_1_0_0_to_1_1_0(project);
  }
  if (project.schemaVersion === '1.1.0') {
    project = migrate_1_1_0_to_1_2_0(project);
  }
  if (project.schemaVersion === '1.2.0') {
    project = migrate_1_2_0_to_1_3_0(project);
  }
  // Kelajakda: if (project.schemaVersion === '1.3.0') { project = migrate_1_3_0_to_1_4_0(project); }
  if (project.schemaVersion !== fromVersion) {
    console.info(`[Migration] Loyiha schema v${fromVersion} \u2192 v${project.schemaVersion}`);
    AppState.commandLog.push({
      id: uuid(), type: 'SCHEMA_MIGRATED', ts: new Date().toLocaleTimeString('uz-UZ'),
      error: false, undone: false, info: `${fromVersion} \u2192 ${project.schemaVersion}`
    });
  }
  return project;
}
