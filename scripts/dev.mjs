// NODE_OPTIONS=... の前置きはWindowsのシェルで動かないため、Nodeから環境変数を渡して起動する
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next')
const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim() },
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
