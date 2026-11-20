/**
 * M0 — Paramètres → « Mise en production » (demande client du 19/11/2026) : règles PURES de la fenêtre
 * (testées par tests/mise-en-production.test.ts). La base fait foi : `production_overview` donne la
 * liste et l'état, `production_apply` refait tous les contrôles ; ce module ne sert qu'à griser les
 * cases et les boutons et à traduire les refus.
 *
 * Actions :
 *   - start : passe en Actif (envoi réel) ;
 *   - test  : passe en Test (tout part à l'adresse / au numéro de test) — éléments qui ont un mode test ;
 *   - pause : remet en Arrêté (chemin inverse, en cas de problème).
 * Un élément non configuré (secret manquant, boîte d'envoi absente…) ne peut être ni démarré ni passé
 * en test ; il reste cochable pour être mis en pause s'il tourne. Une société de test ne démarre jamais.
 */
import type { StatusTone } from '@/components/status-badge';

export const PRODUCTION_MODES = ['arrete', 'test', 'actif', 'non_utilise'] as const;
export type ProductionMode = (typeof PRODUCTION_MODES)[number];
export type ProductionAction = 'start' | 'test' | 'pause';

export const PRODUCTION_GROUPS = ['shopify', 'mail', 'sms', 'accounting', 'outlook', 'portal', 'payment'] as const;
export type ProductionGroup = (typeof PRODUCTION_GROUPS)[number];

export type ProductionItem = {
  key: string;
  group: ProductionGroup;
  mode: ProductionMode;
  /** Ce qui manque pour démarrer (codes : graph_secret, sender_mailbox, depends_sms…). */
  missing: string[];
  /** Ce qui manque en plus pour le mode test (adresse ou numéro de test). */
  missing_test: string[];
  test_ok: boolean;
  detail: Record<string, unknown>;
};

export type CronJob = {
  jobname: string; schedule: string; active: boolean;
  last_status: string | null; last_run: string | null; last_message: string | null;
};

export type ProductionOverview = {
  company_id: string;
  is_test_company: boolean;
  sender_mailbox: string | null;
  mailboxes: string[];
  mail_test_recipient: string | null;
  settings: { sender_mailbox: string | null; mail_test_recipient: string | null } | null;
  integrations: Record<string, { present: boolean; checked_at: string }>;
  items: ProductionItem[];
  crons: CronJob[];
};

/** Dépendances qu'une même sélection peut satisfaire (démarrer le SMS ET le SMS de fin de travaux). */
const DEPENDS: Record<string, string> = { depends_sms: 'sms', depends_outlook_poll: 'outlook_poll' };

export function normalizeProductionMode(m: unknown): ProductionMode {
  return (PRODUCTION_MODES as readonly string[]).includes(String(m)) ? (m as ProductionMode) : 'arrete';
}

/** Statut = couleur + icône + libellé : la couleur ici, jamais le rouge de la marque. */
export function productionTone(mode: ProductionMode): StatusTone {
  return mode === 'actif' ? 'success' : mode === 'test' ? 'warning' : 'neutral';
}

/** Ce qui manque pour cette action, compte tenu des autres éléments cochés. */
export function missingFor(item: ProductionItem, action: ProductionAction, selected: ReadonlySet<string>): string[] {
  if (action === 'pause') return [];
  const base = (item.missing ?? []).filter((m) => !(action === 'start' && DEPENDS[m] && selected.has(DEPENDS[m])));
  return action === 'test' ? [...base, ...(item.missing_test ?? [])] : base;
}

/** L'action est-elle possible pour cet élément ? */
export function canAct(item: ProductionItem, action: ProductionAction, isTestCompany: boolean, selected: ReadonlySet<string> = new Set()): boolean {
  if (action === 'pause') return item.mode === 'actif' || item.mode === 'test';
  if (isTestCompany || item.key === 'stripe' || item.mode === 'non_utilise') return false;
  if (action === 'test' && (!item.test_ok || item.mode === 'test')) return false;
  if (action === 'start' && item.mode === 'actif') return false;
  return missingFor(item, action, selected).length === 0;
}

/** Case à cocher : seulement si au moins une action est possible (non configuré et arrêté → grisé). */
export function isCheckable(item: ProductionItem, isTestCompany: boolean): boolean {
  const all = new Set<string>(Object.values(DEPENDS));
  return canAct(item, 'start', isTestCompany, all) || canAct(item, 'test', isTestCompany) || canAct(item, 'pause', isTestCompany);
}

/** Le bouton de l'action est actif si TOUTE la sélection la permet (la base refuse tout ou rien). */
export function selectionAllows(items: ProductionItem[], selected: ReadonlySet<string>, action: ProductionAction, isTestCompany: boolean): boolean {
  const chosen = items.filter((i) => selected.has(i.key));
  return chosen.length > 0 && chosen.every((i) => canAct(i, action, isTestCompany, selected));
}

export function targetMode(action: ProductionAction): ProductionMode {
  return action === 'start' ? 'actif' : action === 'test' ? 'test' : 'arrete';
}

/**
 * Refus de la base → clé i18n + variables. MEP_NOT_CONFIGURED:<clé>:<manques>, MEP_TEST_COMPANY,
 * MEP_NO_TEST_MODE:<clé>, MEP_NOT_USED:<clé>, MEP_FORBIDDEN, MEP_UNKNOWN_MAILBOX, MEP_BAD_TEST_RECIPIENT.
 */
export function productionErrorKey(message: string): { key: string; item?: string; missing?: string[] } {
  const m = /(MEP_[A-Z_]+)(?::([a-z_]+))?(?::([a-z_,]+))?/.exec(String(message ?? ''));
  if (!m) return { key: 'generic' };
  const code = m[1];
  const known = ['MEP_NOT_CONFIGURED', 'MEP_TEST_COMPANY', 'MEP_NO_TEST_MODE', 'MEP_NOT_USED', 'MEP_FORBIDDEN',
    'MEP_UNKNOWN_MAILBOX', 'MEP_BAD_TEST_RECIPIENT', 'MEP_EMPTY', 'MEP_UNKNOWN_KEY'];
  if (!known.includes(code)) return { key: 'generic' };
  return { key: code, item: m[2], missing: m[3] ? m[3].split(',').filter(Boolean) : undefined };
}

/** Tâches pg_cron : à quel élément de la fenêtre chacune sert (les autres sont internes). */
export const CRON_ITEM: Record<string, string> = {
  'outlook-poll': 'outlook_poll',
  'dispatch-notifications': 'mail_queue',
  'invoice-reminders': 'invoice_reminder_auto',
  'appointment-reminders': 'appointment_reminder_mail',
  'sms-appointment-reminders': 'sms_reminder',
  'followups-plan': 'followups',
  'followups-send': 'followups',
  'shopify-push': 'shopify_stock',
  'shopify-orders-catchup': 'shopify_orders',
  'accounting-auto-transfer': 'accounting_auto_transfer',
};

/** État d'une tâche planifiée : désactivée, dernière exécution en échec, ou en marche. */
export function cronTone(job: CronJob): { tone: StatusTone; state: 'inactive' | 'failed' | 'ok' | 'never' } {
  if (!job.active) return { tone: 'neutral', state: 'inactive' };
  if (!job.last_status) return { tone: 'info', state: 'never' };
  if (job.last_status === 'failed') return { tone: 'danger', state: 'failed' };
  return { tone: 'success', state: 'ok' };
}

/* ─────────────────────────────────────────────────────────────────────────
   Revue UX/UI (20/11/2026) : sur chaque ligne, un choix « Arrêté · Test · Actif » en 3 boutons au
   lieu d'une case à cocher. Mêmes règles qu'avant (canAct / missingFor) : seul l'écran change. Les
   choix de toutes les lignes sont appliqués ensemble, une action à la fois (la base refait les
   contrôles et refuse tout ou rien pour chaque action).
   ───────────────────────────────────────────────────────────────────────── */

/** Les trois choix d'une ligne, dans l'ordre d'affichage. */
export const PRODUCTION_CHOICES: { action: ProductionAction; mode: ProductionMode }[] = [
  { action: 'pause', mode: 'arrete' },
  { action: 'test', mode: 'test' },
  { action: 'start', mode: 'actif' },
];

/** Ordre d'application : d'abord ce qui s'arrête, puis le test, enfin ce qui démarre. */
export const APPLY_ORDER: ProductionAction[] = ['pause', 'test', 'start'];

/** Le bouton de ce choix est-il cliquable sur cette ligne ? (dépendances : peuvent être choisies en même temps) */
export function choiceEnabled(item: ProductionItem, action: ProductionAction, isTestCompany: boolean): boolean {
  if (targetMode(action) === item.mode) return false;
  const all = new Set<string>(Object.values(DEPENDS));
  return canAct(item, action, isTestCompany, action === 'start' ? all : new Set());
}

export type ProductionPlan = {
  /** Clés à passer par action (vide si rien). */
  byAction: Record<ProductionAction, string[]>;
  /** Lignes dont le choix n'est pas possible tel quel (ex. dépendance arrêtée et non choisie). */
  invalid: string[];
  count: number;
};

/** Les changements choisis, regroupés par action, et ceux qui ne passeraient pas. */
export function planChanges(items: ProductionItem[], targets: Readonly<Record<string, ProductionAction>>, isTestCompany: boolean): ProductionPlan {
  const byAction: Record<ProductionAction, string[]> = { pause: [], test: [], start: [] };
  const invalid: string[] = [];
  const starting = new Set(Object.entries(targets).filter(([, a]) => a === 'start').map(([k]) => k));
  for (const it of items) {
    const action = targets[it.key];
    if (!action || targetMode(action) === it.mode) continue;
    byAction[action].push(it.key);
    if (!canAct(it, action, isTestCompany, starting)) invalid.push(it.key);
  }
  return { byAction, invalid, count: byAction.pause.length + byAction.test.length + byAction.start.length };
}
