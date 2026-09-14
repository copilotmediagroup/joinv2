import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import process from 'node:process'

const root = new URL('../src/', import.meta.url)
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

const forbidden = [
  {
    pattern: /\.rpc\(\s*['"]get_my_direct_threads['"]/, 
    message: 'Use get_my_direct_threads_page instead of the retired unbounded RPC.',
  },
  {
    pattern: /\.rpc\(\s*['"]get_my_signal_connections['"]/, 
    message: 'Use get_my_signal_connections_page instead of the retired unbounded RPC.',
  },
  {
    pattern: /\.rpc\(\s*['"]get_my_blocked_users['"]/, 
    message: 'Use get_my_blocked_users_page instead of the retired unbounded RPC.',
  },
  {
    pattern: /\.rpc\(\s*['"]get_my_active_signal_resume['"]/, 
    message: 'Use get_my_active_signal_journey_resume instead of the legacy resume RPC.',
  },
  {
    pattern: /\.rpc\(\s*['"]get_signal_moments['"]/, 
    message: 'Use get_signal_moments_page instead of the retired hard-cap Moments RPC.',
  },
  {
    pattern: /\.rpc\(\s*['"]send_plan_message['"]/,
    message: 'Use send_plan_message_v2 so Plan sends are idempotent and retry-safe.',
  },
  {
    pattern: /\.rpc\(\s*['"]send_my_direct_message['"]/,
    message: 'Use send_my_direct_message_v2 so direct sends are idempotent and retry-safe.',
  },
  {
    pattern: /\.rpc\(\s*['"]report_user['"]/,
    message: 'Use report_user_v2 so one report submission is idempotent and retry-safe.',
  },
  {
    pattern: /\.rpc\(\s*['"]propose_plan_change['"]/,
    message: 'Use propose_plan_change_v2 so one Plan-change submission is idempotent and retry-safe.',
  },
  {
    pattern: /\.rpc\(\s*['"]enforce_user_account['"]/,
    message: 'Use enforce_user_account_v2 so one admin enforcement click is idempotent and retry-safe.',
  },
  {
    pattern: /\.rpc\(\s*['"]lift_user_account_restriction['"]/,
    message: 'Use lift_user_account_restriction_v2 so restriction lifts recover safely after transport failure.',
  },
  {
    pattern: /\.rpc\(\s*['"]enforce_moment_author_account['"]/,
    message: 'Use enforce_moment_author_account_v2 so Moment-author enforcement is idempotent and retry-safe.',
  },
]

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(target))
    else if (allowedExtensions.has(extname(entry.name))) files.push(target)
  }
  return files
}

const srcPath = new URL('.', root).pathname
const files = await walk(srcPath)
const violations = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) {
      violations.push(`${relative(srcPath, file)}: ${rule.message}`)
    }
  }
}

if (violations.length > 0) {
  console.error('Contract verification failed:')
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exitCode = 1
} else {
  console.log('Contract verification passed.')
}
