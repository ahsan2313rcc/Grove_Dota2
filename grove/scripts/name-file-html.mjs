import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(root, 'dist-file', 'index.html')
const named = join(root, 'dist-file', 'Grove.html')
const shipped = join(root, 'Grove.html')

if (!existsSync(built)) {
  console.error('Missing dist-file/index.html — run vite build first')
  process.exit(1)
}

renameSync(built, named)

// Lone file:// open: drop relative favicon (no sibling assets).
let html = readFileSync(named, 'utf8')
html = html.replace(/\s*<link rel="icon"[^>]*>\s*/i, '\n    ')
writeFileSync(named, html)

copyFileSync(named, shipped)
mkdirSync('/opt/cursor/artifacts', { recursive: true })
copyFileSync(named, '/opt/cursor/artifacts/Grove.html')

for (const extra of ['favicon.svg']) {
  const p = join(root, 'dist-file', extra)
  if (existsSync(p)) rmSync(p)
}

console.log(`Wrote ${named}`)
console.log(`Wrote ${shipped}`)
console.log('Wrote /opt/cursor/artifacts/Grove.html')
