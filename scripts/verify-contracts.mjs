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
