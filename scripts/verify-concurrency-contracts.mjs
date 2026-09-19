import { readFile } from 'node:fs/promises'
import process from 'node:process'

const root = new URL('../', import.meta.url)
const read = async (path) => readFile(new URL(path, root), 'utf8')
const checks = []
const requireMatch = (name, source, pattern, reason) => checks.push({ name, ok: pattern.test(source), reason })

const formation = await read('supabase/migrations/0063_signal_chemistry_soft_group_composition.sql')
const blockSafeFormation = await read('supabase/migrations/0090_block_safe_signal_matching.sql')
const assignedRetryFastPath = await read('supabase/migrations/20260919044726_signal_assigned_retry_fast_path.sql')
const conversion = await read('supabase/migrations/0033_signal_plan_conversion_authority_v2.sql')
const confirmation = await read('supabase/migrations/0026_signal_confirmation_canonical_lock_order.sql')
const messageRepair = await read('supabase/migrations/20260914043500_repair_message_idempotency_conflict.sql')
const messageRetirement = await read('supabase/migrations/20260914044000_retire_non_idempotent_message_sends.sql')
const notifications = await read('supabase/migrations/0037_signal_notifications_authority.sql')
const singleJourney = await read('supabase/migrations/0071_signal_single_live_journey_and_plan_resume.sql')
const planChange = await read('supabase/migrations/20260914053000_idempotent_plan_change_proposals.sql')
const moderation = await read('supabase/migrations/20260914212500_retry_safe_moderation_claims.sql')

requireMatch('formation named-window serialization', formation, /pg_advisory_xact_lock\s*\(/i, 'same hard Signal identity must serialize before group selection')
requireMatch('formation capacity row revalidation', formation, /limit\s+1\s+for update/i, 'selected accepting group must be locked before delegation')
requireMatch('assigned retry bypass precedes named-window lock', assignedRetryFastPath, /ASSIGNED-USER RETRY FAST PATH[\s\S]*?for share of si, sgm, sg;[\s\S]*?return;[\s\S]*?NAMED-WINDOW CONCURRENCY LOCK/i, 'already-assigned retries must return before entering first-time formation serialization')
requireMatch('assigned retry protects authoritative rows', assignedRetryFastPath, /for share of si, sgm, sg;/i, 'retry fast path must prevent concurrent withdrawal or group mutation while returning authority')
requireMatch('block-safe formation serialization', blockSafeFormation, /pg_advisory_xact_lock\s*\(/i, 'latest block-safe formation authority must preserve hard-identity serialization')
requireMatch('single live journey uniqueness', singleJourney, /create unique index if not exists signal_intents_one_assigned_per_user_idx/i, 'database must reject two assigned Signal intents for one user')
requireMatch('confirmation canonical group lock', confirmation, /signal_groups[\s\S]{0,500}for update/i, 'confirmation must serialize on the authoritative Signal group')
requireMatch('conversion group row lock', conversion, /signal_groups[\s\S]{0,500}for update/i, 'Signal-to-Plan conversion must serialize on the Signal group')
requireMatch('conversion retry idempotency', conversion, /originating_signal_group_id/i, 'Signal-origin Plan identity must be stable across retries')
requireMatch('plan message retry dedupe', messageRepair, /on conflict do nothing/i, 'message retry must not create duplicate message rows')
requireMatch('legacy non-idempotent sends retired', messageRetirement, /Legacy non-idempotent send retained for migration history only/i, 'browser callers must not use legacy message mutation')
requireMatch('notification user dedupe key', notifications, /notifications_user_dedupe_key/i, 'replayed domain events must not duplicate user notifications')
requireMatch('plan change client idempotency', planChange, /plan_change_proposals_proposer_client_key/i, 'double clicks/retries must not create duplicate proposals')
requireMatch('moderation concurrent claim isolation', moderation, /for update skip locked/i, 'concurrent workers must not claim the same moderation work')

const failures = checks.filter((check) => !check.ok)
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`)
if (failures.length) {
  console.error('\nConcurrency contract verification failed:')
  failures.forEach((check) => console.error(`- ${check.name}: ${check.reason}`))
  process.exitCode = 1
} else {
  console.log(`\nConcurrency contract verification passed (${checks.length}/${checks.length}).`)
}
