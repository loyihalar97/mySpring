/* =========================================================================
   core/commands.js
   ---------------------------------------------------------------------
   Yagona mutatsiya eshigi (Single Mutation Gateway). Har bir handler:
   (project, payload) -> yangi, immutable project.

   Sprint R1 qarori: bu modul rendering/ui'ga HECH QANDAY bog'liq emas.
   dispatch() muvaffaqiyatli/rad etilgan holatni core/state.js orqali
   notifyStateChange() bilan e'lon qiladi — render() yoki toast()ni
   to'g'ridan-to'g'ri chaqirmaydi. main.js markazlashtirilgan obunachi
   orqali render/autosave/asset-cleanup/toast'ni bog'laydi.
   ========================================================================= */

import {
  uuid,
  createProject, createSlide, createTextElement, createImageElement,
  createShapeElement, createQuizElement,
  cloneElementWithNewId, cloneSlideWithNewIds,
  getCompletionSettings,
} from './object-model.js';
import { clamp } from './utils.js';
import { AppState, notifyStateChange } from './state.js';
import { pushHistory, logCommand } from './history.js';
import { validatePostState } from './validation.js';

export const CommandHandlers = {
  CREATE_PROJECT: (project, { name }) => createProject(name),

  // passingScore 0-100 oralig'idan tashqariga chiqishi STRUKTURAVIY
  // jihatdan KONSTRUKSIYA orqali imkonsiz qilinadi (validatsiya qatlamiga
  // muhtoj emas).
  SET_COURSE_PASSING_SCORE: (project, { passingScore }) => ({
    ...project,
    completionSettings: { ...getCompletionSettings(project), passingScore: clamp(Math.round(passingScore), 0, 100) }
  }),

  SET_REQUIRE_ALL_QUIZZES_SUBMITTED: (project, { required }) => ({
    ...project,
    completionSettings: { ...getCompletionSettings(project), requireAllQuizzesSubmitted: !!required }
  }),

  CREATE_SLIDE: (project) => ({
    ...project,
    slides: [...project.slides, createSlide()]
  }),

  DELETE_SLIDE: (project, { slideId }) => ({
    ...project,
    slides: project.slides.filter(s => s.id !== slideId)
  }),

  DUPLICATE_SLIDE: (project, { slideId }) => {
    const idx = project.slides.findIndex(s => s.id === slideId);
    if (idx === -1) return project;
    const clone = cloneSlideWithNewIds(project.slides[idx]);
    const slides = [...project.slides];
    slides.splice(idx + 1, 0, clone);
    return { ...project, slides };
  },

  REORDER_SLIDES: (project, { orderedSlideIds }) => {
    const map = new Map(project.slides.map(s => [s.id, s]));
    const slides = orderedSlideIds.map(id => map.get(id)).filter(Boolean);
    if (slides.length !== project.slides.length) return project;
    return { ...project, slides };
  },

  ADD_TEXT_ELEMENT: (project, { slideId, x, y }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: [...slide.elements, createTextElement(x, y, nextZIndex(slide))]
  })),

  ADD_IMAGE_ELEMENT: (project, { slideId, x, y, assetId, src }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: [...slide.elements, createImageElement(x, y, nextZIndex(slide), { assetId, src })]
  })),

  ADD_SHAPE_ELEMENT: (project, { slideId, shapeType, x, y }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: [...slide.elements, createShapeElement(shapeType, x, y, nextZIndex(slide))]
  })),

  ADD_QUIZ_ELEMENT: (project, { slideId, x, y, questionType }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: [...slide.elements, createQuizElement(questionType, x, y, nextZIndex(slide))]
  })),

  SET_QUIZ_QUESTION_TEXT: (project, { slideId, elementId, text }) => mutateElement(project, slideId, elementId, el => ({
    ...el, questionText: text
  })),

  ADD_QUIZ_ANSWER: (project, { slideId, elementId }) => mutateElement(project, slideId, elementId, el => ({
    ...el, answers: [...el.answers, { id: uuid(), text: `Variant ${el.answers.length + 1}`, correct: false }]
  })),

  // "Kamida 2 ta javob" qoidasi ATAYLAB bu yerda tekshirilmaydi — bu
  // Validation Layer (validatePostState/validateQuizStructural)ning
  // vazifasi, Command Handler emas.
  REMOVE_QUIZ_ANSWER: (project, { slideId, elementId, answerId }) => mutateElement(project, slideId, elementId, el => ({
    ...el, answers: el.answers.filter(a => a.id !== answerId)
  })),

  REORDER_QUIZ_ANSWERS: (project, { slideId, elementId, orderedAnswerIds }) => mutateElement(project, slideId, elementId, el => {
    const map = new Map(el.answers.map(a => [a.id, a]));
    const answers = orderedAnswerIds.map(id => map.get(id)).filter(Boolean);
    if (answers.length !== el.answers.length) return el;
    return { ...el, answers };
  }),

  SET_QUIZ_ANSWER_TEXT: (project, { slideId, elementId, answerId, text }) => mutateElement(project, slideId, elementId, el => ({
    ...el, answers: el.answers.map(a => a.id === answerId ? { ...a, text } : a)
  })),

  // single turida: "correct:true" — boshqa barcha javoblarni avtomatik
  // false qiladi (>1 to'g'ri javob STRUKTURAVIY jihatdan imkonsiz).
  // "correct:false" — YAGONA to'g'ri javobni ham vaqtincha o'chirishga
  // RUXSAT BERILADI — natijada "0 to'g'ri javob" holati endi faqat
  // Authoring Warning, Command rad etilmaydi.
  SET_QUIZ_ANSWER_CORRECT: (project, { slideId, elementId, answerId, correct }) => mutateElement(project, slideId, elementId, el => {
    if (el.questionType === 'single') {
      if (correct) {
        return { ...el, answers: el.answers.map(a => ({ ...a, correct: a.id === answerId })) };
      }
      return { ...el, answers: el.answers.map(a => a.id === answerId ? { ...a, correct: false } : a) };
    }
    return { ...el, answers: el.answers.map(a => a.id === answerId ? { ...a, correct } : a) };
  }),

  SET_QUIZ_CORRECT_FEEDBACK: (project, { slideId, elementId, text }) => mutateElement(project, slideId, elementId, el => ({
    ...el, feedback: { ...el.feedback, correctText: text }
  })),

  SET_QUIZ_INCORRECT_FEEDBACK: (project, { slideId, elementId, text }) => mutateElement(project, slideId, elementId, el => ({
    ...el, feedback: { ...el.feedback, incorrectText: text }
  })),

  MOVE_ELEMENT: (project, { slideId, elementId, x, y }) => mutateElement(project, slideId, elementId, el => ({
    ...el, x, y
  })),

  MOVE_ELEMENTS: (project, { slideId, moves }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: slide.elements.map(el => {
      const m = moves.find(m => m.elementId === el.id);
      return m ? { ...el, x: m.x, y: m.y } : el;
    })
  })),

  RESIZE_ELEMENT: (project, { slideId, elementId, width, height }) => mutateElement(project, slideId, elementId, el => ({
    ...el,
    width: Math.max(24, width),
    height: Math.max(24, height)
  })),

  SET_TEXT: (project, { slideId, elementId, text }) => mutateElement(project, slideId, elementId, el => ({
    ...el, text
  })),

  DELETE_ELEMENT: (project, { slideId, elementId }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: slide.elements.filter(el => el.id !== elementId)
  })),

  DELETE_ELEMENTS: (project, { slideId, elementIds }) => mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: slide.elements.filter(el => !elementIds.includes(el.id))
  })),

  DUPLICATE_ELEMENT: (project, { slideId, elementId }) => mutateSlide(project, slideId, slide => {
    const original = slide.elements.find(el => el.id === elementId);
    if (!original) return slide;
    const { element } = cloneElementWithNewId(original);
    const clone = { ...element, zIndex: nextZIndex(slide) };
    return { ...slide, elements: [...slide.elements, clone] };
  }),

  PASTE_ELEMENTS: (project, { slideId, elements }) => mutateSlide(project, slideId, slide => {
    let z = nextZIndex(slide);
    const cloned = elements.map(el => {
      const { element } = cloneElementWithNewId(el, 20, 20);
      return { ...element, zIndex: z++ };
    });
    return { ...slide, elements: [...slide.elements, ...cloned] };
  }),
};

export function mutateSlide(project, slideId, fn) {
  return {
    ...project,
    slides: project.slides.map(s => s.id === slideId ? fn(s) : s)
  };
}

export function mutateElement(project, slideId, elementId, fn) {
  return mutateSlide(project, slideId, slide => ({
    ...slide,
    elements: slide.elements.map(el => el.id === elementId ? fn(el) : el)
  }));
}

// Slayd ichidagi eng yuqori zIndex'dan 1 ta katta qiymat.
export function nextZIndex(slide) {
  if (!slide.elements.length) return 0;
  return Math.max(...slide.elements.map(e => e.zIndex ?? 0)) + 1;
}

// --- Validation (Command Validation: pre-condition check) ---
export function validateCommand(project, command) {
  if (!CommandHandlers[command.type]) return `Noma'lum Command turi: ${command.type}`;
  if (command.type !== 'CREATE_PROJECT' && !project) return 'Loyiha mavjud emas';
  if (command.type === 'DELETE_SLIDE' && project && project.slides.length <= 1) {
    return 'Kamida bitta slayd qolishi kerak';
  }
  return null;
}

export const ASSET_CLEANUP_TRIGGERS = new Set(['DELETE_ELEMENT', 'DELETE_ELEMENTS', 'DELETE_SLIDE']);

// Dispatch — Command Execution Pipeline (validate -> apply -> post-validate -> commit -> notify)
export function dispatch(command) {
  const project = AppState.objectModel.project;
  const commandId = uuid();

  const preError = validateCommand(project, command);
  if (preError) {
    logCommand(command, preError, commandId);
    notifyStateChange({ type: 'rejected', command, error: preError });
    return;
  }

  const newProject = CommandHandlers[command.type](project, command.payload || {});

  const postError = validatePostState(newProject, command);
  if (postError) {
    logCommand(command, postError, commandId);
    notifyStateChange({ type: 'rejected', command, error: postError });
    return; // newProject e'tiborga olinmaydi — Object Model o'zgarmagan holicha qoladi
  }

  logCommand(command, null, commandId);
  AppState.objectModel.project = newProject;

  pushHistory(newProject, commandId);
  notifyStateChange({ type: 'command', command });
}

// Eslatma (Sprint R1.1): loyiha yaratish endi
// storage/project-storage.js#createAndOpenNewProject() orqali amalga
// oshiriladi (Project Library ko'p-loyihali modeliga mos). Bu yerdagi
// CREATE_PROJECT CommandHandler o'zi — createProject() factory'ni
// chaqiruvchi sof funksiya sifatida — o'sha joyda ham qayta ishlatiladi.
