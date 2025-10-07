export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function mergeRanges(ranges) {
  if (!ranges.length) return []
  const sorted = ranges
    .map(([from, to]) => [from, to])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const [from, to] = sorted[i]
    const last = merged[merged.length - 1]
    if (from <= last[1]) {
      last[1] = Math.max(last[1], to)
    } else {
      merged.push([from, to])
    }
  }
  return merged
}

export function collectChangedTextblockRanges(tr) {
  const ranges = []
  const { mapping } = tr
  const docSize = tr.doc.content.size
  mapping.maps.forEach((stepMap, index) => {
    const remainder = mapping.slice(index + 1)
    stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
      let from = remainder.map(newStart, -1)
      let to = remainder.map(newEnd, 1)
      if (to < from) [from, to] = [to, from]
      from = clamp(from, 0, docSize)
      to = clamp(to, 0, docSize)
      if (to <= from) {
        from = clamp(from - 1, 0, docSize)
        to = clamp(to + 1, 0, docSize)
        if (to <= from) {
          to = clamp(from + 1, 0, docSize)
        }
      }
      ranges.push([from, to])
    })
  })
  return mergeRanges(ranges)
}
