export function formatTimestamp(stamp) {
  if (!stamp) return 'unknown'
  const date = typeof stamp === 'string' ? new Date(stamp) : stamp
  if (!date || Number.isNaN(date.valueOf())) {
    return String(stamp)
  }
  return date.toLocaleString()
}
