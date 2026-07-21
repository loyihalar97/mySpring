/* =========================================================================
   core/history.js
   ---------------------------------------------------------------------
   Undo/Redo stack va Command Log. Sprint 2.5 (P0-2/P0-3) talablariga mos:
   chegaralangan chuqurlik, barqaror ID orqali Log<->History bog'lanishi
   ("last successful command" evristikasi ishlatilmaydi).
   ========================================================================= */

import { AppState, notifyStateChange } from './state.js';

export const MAX_HISTORY = 100;
export const MAX_COMMAND_LOG = 200;

// History stack { id, project } juftliklarini saqlaydi — id orqali
// Command Log yozuvi bilan aniq bog'lanadi.
export function pushHistory(project, commandId) {
  const { stack, pointer } = AppState.history;
  let truncated = stack.slice(0, pointer + 1);      // Redo tarixini tozalash
  truncated.push({ id: commandId, project });
  if (truncated.length > MAX_HISTORY) {
    truncated = truncated.slice(truncated.length - MAX_HISTORY); // eng eskisini tashlab yuborish
  }
  AppState.history.stack = truncated;
  AppState.history.pointer = truncated.length - 1;
}

export function undo() {
  const h = AppState.history;
  if (h.pointer <= 0) return;
  const undoneEntry = h.stack[h.pointer];
  h.pointer -= 1;
  AppState.objectModel.project = h.stack[h.pointer].project;
  markLogEntryUndone(undoneEntry.id, true);
  notifyStateChange({ type: 'undo' });
}

export function redo() {
  const h = AppState.history;
  if (h.pointer >= h.stack.length - 1) return;
  h.pointer += 1;
  const entry = h.stack[h.pointer];
  AppState.objectModel.project = entry.project;
  markLogEntryUndone(entry.id, false);
  notifyStateChange({ type: 'redo' });
}

export function logCommand(command, error, commandId) {
  AppState.commandLog.push({
    id: commandId,
    type: command.type,
    ts: new Date().toLocaleTimeString('uz-UZ'),
    error: !!error,
    undone: false
  });
  if (AppState.commandLog.length > MAX_COMMAND_LOG) {
    AppState.commandLog = AppState.commandLog.slice(AppState.commandLog.length - MAX_COMMAND_LOG);
  }
}

// Endi "oxirgi muvaffaqiyatli yozuv"ni qidirmaydi — bevosita historyEntryId
// bo'yicha aniq mos yozuvni topadi.
export function markLogEntryUndone(historyEntryId, val) {
  const entry = AppState.commandLog.find(e => e.id === historyEntryId);
  if (entry) entry.undone = val;
}
