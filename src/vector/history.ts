/**
 * The history panel's model now lives in `src/editor/history.ts`, shared with the scene editor.
 * The vector editor keeps its own name for it.
 */
export {
  DEFAULT_STEP_LABEL,
  START_LABEL,
  changedIds,
  countedLabel,
  historyRows,
  stepDistance,
  type HistoryRow,
  type HistoryStep,
  type NamedVersion,
} from '@/editor/history'
