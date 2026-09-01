export function timelineSize(preferred: number, viewportHeight: number, mobile: boolean, editingKey = false) {
  const max = Math.max(180, viewportHeight - (mobile ? 260 : 200))
  const min = Math.min(max, editingKey ? 280 : 180)
  const height = Math.min(max, Math.max(min, preferred))
  return { min, max, height }
}
