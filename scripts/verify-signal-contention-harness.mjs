import { readFile } from 'node:fs/promises'
import process from 'node:process'

const root = new URL('../', import.meta.url)
const read = async (path) => readFile(new URL(path, root), 'utf8')
const checks = []
const requireMatch = (name, source, pattern, reason) => checks.push({ name, ok: pattern.test(source), reason })

const harness = await read('supabase/tests/signal_formation_contention_harness.sql')

requireMatch('contention harness is rollback-only', harness, /begin;[\s\S]*rollback;/i, 'load fixtures must never persist')
requireMatch('contention harness creates isolated fixtures', harness, /signal_load_test_/i, 'test identities must be isolated from production users')
requireMatch('contention harness records latency', harness, /clock_timestamp\(\)[\s\S]*elapsed_ms/i, 'each formation call must capture elapsed time')
requireMatch('contention harness checks duplicate assignment', harness, /signal_intents_one_assigned_per_user_idx|assigned_count/i, 'test must prove one assigned intent per user')
requireMatch('contention harness models retries', harness, /attempt_no[\s\S]*primary key \(user_id,attempt_no\)/i, 'runner must be able to record multiple attempts for one user')
requireMatch('contention harness checks retry identity', harness, /count\(distinct signal_intent_id\)[\s\S]*count\(distinct signal_group_id\)[\s\S]*intent_count > 1 or group_count > 1/i, 'successful retries must resolve to the same intent and group')
requireMatch('contention harness checks capacity', harness, /max_capacity[\s\S]*member_count/i, 'test must assert group capacity')
requireMatch('contention harness checks crossed users', harness, /crossed_user/i, 'test must detect cross-key membership')

const failures = checks.filter((check) => !check.ok)
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`)
if (failures.length) {
  console.error('\nSignal contention harness verification failed:')
  failures.forEach((check) => console.error(`- ${check.name}: ${check.reason}`))
  process.exitCode = 1
} else {
  console.log(`\nSignal contention harness verification passed (${checks.length}/${checks.length}).`)
}
