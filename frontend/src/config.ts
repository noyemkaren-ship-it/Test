export type GpConfig = {
  API_URL: string
  OFFLINE_AI_URL: string
  APP_TITLE: string
}

const defaults: GpConfig = {
  // Empty means same origin. Production should reverse-proxy /api to backend.
  API_URL: '',
  OFFLINE_AI_URL: 'http://127.0.0.1:5005',
  APP_TITLE: 'Graph Platform'
}

export function getConfig(): GpConfig {
  const runtime = typeof window !== 'undefined' ? (window as any).__GP_CONFIG__ : null
  return { ...defaults, ...(runtime || {}) }
}

export function apiUrl(path: string): string {
  const base = (getConfig().API_URL || '').replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}
