import { runAudit, formatAudit } from './paramAudit.mjs'
const t0 = Date.now()
const report = runAudit()
console.log(formatAudit(report))
console.log('\n耗时 ' + (Date.now() - t0) + 'ms')
process.exit(report.dead.length ? 1 : 0)
