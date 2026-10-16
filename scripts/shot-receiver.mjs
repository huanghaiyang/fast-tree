import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.SHOT_PORT || 5274)
const DIR = path.resolve(process.env.SHOT_DIR || '.shots')

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
  if (!req.url.startsWith('/shot')) { res.end('fast-tree shot receiver'); return }
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks).toString('utf8')
      const b64 = body.replace(/^data:image\/png;base64,/, '')
      const name = (new URL(req.url, 'http://localhost').searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '')
      fs.mkdirSync(DIR, { recursive: true })
      const file = path.join(DIR, name + '.png')
      fs.writeFileSync(file, Buffer.from(b64, 'base64'))
      console.log('[shot] ' + file + ' (' + Buffer.byteLength(b64, 'base64') + ' bytes)')
      res.end('ok')
    } catch (e) {
      console.error('[shot] failed', e)
      res.statusCode = 500
      res.end(String(e))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => console.log('[shot] receiver on http://127.0.0.1:' + PORT))
