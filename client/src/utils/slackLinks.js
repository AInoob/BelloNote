const SLACK_HOST_SUFFIX = /\.slack\.com$/i

const messageIdToTs = (messageId = '') => {
  if (typeof messageId !== 'string') return ''
  const digits = messageId.replace(/\D/g, '')
  if (digits.length <= 6) return digits
  const head = digits.slice(0, -6)
  const tail = digits.slice(-6)
  return `${head}.${tail}`
}

const buildThreadLink = (url, channelId, messageId) => {
  if (!url || !channelId || !messageId) return null
  const params = new URLSearchParams(url.search)
  params.delete('cid')
  const query = params.toString()
  const base = `${url.protocol}//${url.host}/messages/${channelId}/p${messageId}`
  return query ? `${base}?${query}` : base
}

const buildSlackDeepLink = (teamId, channelId, messageId, threadTs, fallbackWorkspace) => {
  if (!channelId) return null
  const team = (teamId || '').trim() || fallbackWorkspace || ''
  const params = new URLSearchParams()
  if (team) params.set('team', team)
  params.set('id', channelId)
  const resolvedTs = messageIdToTs(messageId) || threadTs
  if (resolvedTs) params.set('message', resolvedTs)
  if (threadTs) params.set('thread_ts', threadTs)
  return `slack://channel?${params.toString()}`
}

export function getSlackLinkInfo(href, options = {}) {
  if (!href || typeof href !== 'string') return null
  const teamIdOverride = typeof options.teamId === 'string' ? options.teamId.trim() : ''
  let parsed
  try {
    parsed = new URL(href)
  } catch {
    return null
  }
  if (!SLACK_HOST_SUFFIX.test(parsed.hostname)) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const [section, channelId, messageSegment] = segments
  if (section !== 'archives' && section !== 'messages') return null
  const messageId = messageSegment && messageSegment.startsWith('p')
    ? messageSegment.slice(1)
    : null
  const threadTs = parsed.searchParams.get('thread_ts') || ''
  const workspace = parsed.hostname.replace(SLACK_HOST_SUFFIX, '')
  const threadLink = messageId ? buildThreadLink(parsed, channelId, messageId) : null
  const deepLink = buildSlackDeepLink(teamIdOverride, channelId, messageId, threadTs, workspace)
  if (!threadLink && !deepLink) return null
  return {
    workspace,
    channelId,
    messageId,
    threadTs,
    threadLink,
    deepLink
  }
}
