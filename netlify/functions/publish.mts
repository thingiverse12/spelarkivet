import type { Config } from '@netlify/functions'
import { createHash, timingSafeEqual } from 'node:crypto'

const API_BASE = 'https://api.netlify.com/api/v1'

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function decodeFile(content: string, encoding: 'utf-8' | 'base64'): Buffer {
  return encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8')
}

function sha1(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export default async (req: Request, context: any) => {
  const apiKey = Netlify.env.get('PUBLISH_API_KEY')
  const deployToken = Netlify.env.get('NETLIFY_DEPLOY_TOKEN')

  if (!apiKey || !deployToken) {
    return Response.json(
      {
        error:
          'Publish API is not configured. Set PUBLISH_API_KEY and NETLIFY_DEPLOY_TOKEN as environment variables for this site.',
      },
      { status: 500 },
    )
  }

  const providedKey = req.headers.get('x-api-key') ?? ''
  if (!safeEqual(providedKey, apiKey)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { files?: Record<string, { content: string; encoding?: 'utf-8' | 'base64' }> }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const incomingFiles = body.files
  if (!incomingFiles || Object.keys(incomingFiles).length === 0) {
    return Response.json(
      { error: 'Provide at least one file: { "files": { "/index.html": { "content": "..." } } }' },
      { status: 400 },
    )
  }

  const siteId = context.site.id
  const authHeaders = { Authorization: `Bearer ${deployToken}` }

  const fileBuffers = new Map<string, Buffer>()
  const filesManifest: Record<string, string> = {}

  try {
    const siteRes = await fetch(`${API_BASE}/sites/${siteId}`, { headers: authHeaders })
    if (!siteRes.ok) {
      return Response.json(
        { error: `Could not read site info from Netlify (status ${siteRes.status}). Check NETLIFY_DEPLOY_TOKEN.` },
        { status: 502 },
      )
    }
    const site = await siteRes.json()
    const publishedDeployId = site.published_deploy?.id

    if (publishedDeployId) {
      const filesRes = await fetch(`${API_BASE}/deploys/${publishedDeployId}/files`, { headers: authHeaders })
      if (filesRes.ok) {
        const currentFiles: Array<{ path: string; sha: string }> = await filesRes.json()
        for (const file of currentFiles) {
          filesManifest[normalizePath(file.path)] = file.sha
        }
      }
    }

    for (const [rawPath, file] of Object.entries(incomingFiles)) {
      const path = normalizePath(rawPath)
      const buffer = decodeFile(file.content, file.encoding ?? 'utf-8')
      fileBuffers.set(path, buffer)
      filesManifest[path] = sha1(buffer)
    }

    const deployRes = await fetch(`${API_BASE}/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filesManifest, draft: false }),
    })
    if (!deployRes.ok) {
      const text = await deployRes.text()
      return Response.json({ error: `Netlify rejected the deploy (status ${deployRes.status}): ${text}` }, { status: 502 })
    }
    const deploy = await deployRes.json()
    const required: string[] = deploy.required ?? []

    const missing = required.filter((path) => !fileBuffers.has(normalizePath(path)))
    if (missing.length > 0) {
      return Response.json(
        {
          error: 'Netlify needs the full content for these files (not previously published) — include them in "files" and retry',
          missing,
        },
        { status: 409 },
      )
    }

    for (const path of required) {
      const buffer = fileBuffers.get(normalizePath(path))!
      const uploadRes = await fetch(`${API_BASE}/deploys/${deploy.id}/files${normalizePath(path)}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/octet-stream' },
        body: buffer,
      })
      if (!uploadRes.ok) {
        const text = await uploadRes.text()
        return Response.json({ error: `Upload failed for ${path} (status ${uploadRes.status}): ${text}` }, { status: 502 })
      }
    }

    return Response.json({
      ok: true,
      deployId: deploy.id,
      state: deploy.state,
      url: deploy.ssl_url ?? deploy.deploy_ssl_url ?? deploy.url,
    })
  } catch (err) {
    return Response.json({ error: `Unexpected error: ${(err as Error).message}` }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/publish',
  method: 'POST',
}
