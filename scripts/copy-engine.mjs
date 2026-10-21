// Copies the single-threaded lite Stockfish build into public/engine/ under fixed names.
// The engine .js locates its wasm by swapping ".js" for ".wasm" in its own URL, so
// stockfish.js + stockfish.wasm load as a pair without patching.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(root, 'node_modules', 'stockfish', 'bin')
if (!existsSync(binDir)) {
  console.warn('copy-engine: stockfish package not installed yet, skipping')
  process.exit(0)
}
const files = readdirSync(binDir)
const js = files.find((f) => /lite-single\.js$/.test(f))
const wasm = files.find((f) => /lite-single\.wasm$/.test(f))
if (!js || !wasm) {
  console.error('copy-engine: could not find *lite-single*.js/.wasm in ' + binDir)
  process.exit(1)
}
const out = join(root, 'public', 'engine')
mkdirSync(out, { recursive: true })
copyFileSync(join(binDir, js), join(out, 'stockfish.js'))
copyFileSync(join(binDir, wasm), join(out, 'stockfish.wasm'))
console.log(`copy-engine: ${js} -> public/engine/stockfish.js, ${wasm} -> public/engine/stockfish.wasm`)
