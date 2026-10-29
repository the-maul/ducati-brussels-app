/**
 * M2 — Moteur de traduction des designations, cote application.
 * Le code vit dans supabase/functions/_shared (partage avec l'Edge Function
 * translate-designations) ; ce fichier n'est que le point d'entree de l'app.
 */
export {
  translateWithGlossary, detectLanguage, isCoveredByGlossary, tokenize, normalizeText,
  partitionByMemory, memoryRowsFor,
  type GlossaryResult, type I18n, type Lang, type MemoryRow, type MemoryItem, type MemoryHit,
} from '../../../../supabase/functions/_shared/designation-engine';
export { GLOSSARY, LANGS } from '../../../../supabase/functions/_shared/designation-glossary';
