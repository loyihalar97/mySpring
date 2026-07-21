/* =========================================================================
   core/object-model.js
   ---------------------------------------------------------------------
   Deklarativ, serializable, framework-agnostic sxema. Rendering yoki UI
   kodi buni HECH QACHON to'g'ridan-to'g'ri mutatsiya qilmaydi — faqat
   core/commands.js (Command Layer) orqali.

   Sprint R1 arxitektura qarori: bu modul HECH QANDAY boshqa modulga
   bog'liq emas (core/state.js'ga ham) — Object Model o'zi qanday
   render qilinishi yoki qaysi runtime holatda ekanidan mustaqil bo'lishi
   kerak. Shuning uchun resolveThemeColor() endi global holatni o'qimaydi,
   `project`ni parametr sifatida qabul qiladi (monolitdagi
   `AppState.objectModel.project`ga bevosita murojaat qilishning o'rniga —
   bu ko'rinadigan xatti-harakatni o'zgartirmaydi, faqat ichki chegarani
   tozalaydi).
   ========================================================================= */

export const SCHEMA_VERSION = "1.3.0";

// ---- Course Completion Settings (Sprint 4.1) ----
// Bu — Course/Project Object Model'ning bir qismi, UI State EMAS.
export const DEFAULT_COMPLETION_SETTINGS = {
  passingScore: 80,                 // 0-100 oralig'idagi foiz
  requireAllQuizzesSubmitted: true,
};

export function getCompletionSettings(project) {
  return (project && project.completionSettings) || DEFAULT_COMPLETION_SETTINGS;
}

// ---- Minimal Theme Tokens (P1-7: to'liq Theme Engine emas, oraliq qadam) ----
export const DEFAULT_THEME_TOKENS = {
  'shape.primary.fill': '#37d99b',
  'shape.primary.stroke': '#1f8a63',
};

// `project` endi majburiy parametr (Sprint R1 refaktori — avval global
// AppState'dan o'qilardi). Chaqiruvchi (rendering/element-renderers.js)
// buni aniq uzatadi.
export function resolveThemeColor(el, kind, project) {
  const tokenKey = kind === 'fill' ? el.fillToken : el.strokeToken;
  const tokens = (project && project.themeTokens) || DEFAULT_THEME_TOKENS;
  if (tokenKey && tokens[tokenKey]) return tokens[tokenKey];
  const legacy = kind === 'fill' ? el.fill : el.stroke; // Sprint 2'dan qolgan xom qiymat — orqaga moslik
  if (legacy) return legacy;
  return DEFAULT_THEME_TOKENS[kind === 'fill' ? 'shape.primary.fill' : 'shape.primary.stroke'];
}

export function uuid() {
  return (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    }));
}

export const SHAPE_DEFAULTS = {
  rectangle: { width: 200, height: 120 },
  roundedRectangle: { width: 200, height: 120 },
  circle: { width: 140, height: 140 },
  line: { width: 220, height: 6 },
};

export function createTextElement(x, y, zIndex, text) {
  return {
    id: uuid(), type: 'text', x, y,
    width: 240, height: 50,
    zIndex,
    text: text ?? 'Matnni bosing va tahrirlang',
    metadata: { createdAt: Date.now() }
  };
}

export function createImageElement(x, y, zIndex, { assetId = null, src = null } = {}) {
  return {
    id: uuid(), type: 'image', x, y,
    width: 220, height: 160,
    zIndex,
    assetId,   // Uploaded rasm — haqiqiy binary AssetStorage'da, bu yerda faqat havola
    src,       // Legacy/tashqi URL orqali qo'shilgan rasm (orqaga moslik uchun)
    metadata: { createdAt: Date.now() }
  };
}

export function createShapeElement(shapeType, x, y, zIndex) {
  const d = SHAPE_DEFAULTS[shapeType] || { width: 160, height: 100 };
  return {
    id: uuid(), type: 'shape', shapeType, x, y,
    width: d.width, height: d.height,
    zIndex,
    fillToken: 'shape.primary.fill',
    strokeToken: 'shape.primary.stroke',
    metadata: { createdAt: Date.now() }
  };
}

// ---- QUIZ ENGINE (Sprint 3) ----
// questionType: 'single' | 'multiple'. Default holat ATAYLAB ikkalasi uchun
// ham to'g'ri (bitta correct:true, bitta correct:false).
export function createQuizElement(questionType, x, y, zIndex) {
  return {
    id: uuid(), type: 'quiz', questionType, x, y,
    width: 360, height: 240,
    zIndex,
    questionText: 'Savolingizni kiriting',
    answers: [
      { id: uuid(), text: 'Variant 1', correct: true },
      { id: uuid(), text: 'Variant 2', correct: false },
    ],
    feedback: {
      correctText: "To\u2018g\u2018ri!",
      incorrectText: "Noto\u2018g\u2018ri!"
    },
    metadata: { createdAt: Date.now() }
  };
}

/* =========================================================================
   ELEMENT CLONE IDENTITY POLICY REGISTRY
   ---------------------------------------------------------------------
   Immutability faqat tasodifiy mutatsiyadan himoya qiladi — u duplikat
   ID'larni "xavfsiz" qilmaydi. Har bir Element turi ixtiyoriy ravishda
   o'zining ICHKI (nested) identifikatorlarini (masalan, Quiz'ning
   answers[].id) qanday qayta generatsiya qilishni shu yerda, MARKAZLASHGAN
   holda e'lon qiladi.

   Bu orqali generic Command'lar (DUPLICATE_ELEMENT, PASTE_ELEMENTS,
   DUPLICATE_SLIDE) HECH QACHON "agar type === 'quiz'" kabi maxsus
   shoxobchalarga muhtoj bo'lmaydi.
   ========================================================================= */
export const ElementCloneIdentityPolicies = {
  quiz: (el, idMap) => {
    const newAnswers = el.answers.map(a => {
      const newAnswerId = uuid();
      idMap.set(a.id, newAnswerId);
      return { ...a, id: newAnswerId };
    });
    return { ...el, answers: newAnswers };
  },
};

// Element'ni yangi ID bilan (va, agar policy mavjud bo'lsa, barcha ICHKI
// ID'lar bilan ham) klonlash — Duplicate/Paste/Slide-Duplicate uchun umumiy.
export function cloneElementWithNewId(el, offsetX = 16, offsetY = 16) {
  const idMap = new Map();

  const policy = ElementCloneIdentityPolicies[el.type];
  const withRegeneratedNestedIds = policy ? policy(el, idMap) : el;

  const newElementId = uuid();
  idMap.set(el.id, newElementId);

  const element = {
    ...withRegeneratedNestedIds,
    id: newElementId,
    x: el.x + offsetX,
    y: el.y + offsetY,
    metadata: { ...el.metadata, createdAt: Date.now() }
  };

  return { element, idMap };
}

export function cloneSlideWithNewIds(slide) {
  return {
    id: uuid(),
    elements: slide.elements.map(el => cloneElementWithNewId(el, 0, 0).element)
  };
}

export function createSlide() {
  return { id: uuid(), elements: [] };
}

export function createProject(name) {
  return {
    id: uuid(),
    schemaVersion: SCHEMA_VERSION,
    name,
    themeTokens: { ...DEFAULT_THEME_TOKENS },
    completionSettings: { ...DEFAULT_COMPLETION_SETTINGS },
    slides: [createSlide()],
    metadata: { createdAt: Date.now() }
  };
}
