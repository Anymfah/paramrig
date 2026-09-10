/** The initials a label starts from, before anything is done about two labels sharing them. */
function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0]
  const b = parts[1]?.[0]
  return ((a ?? '?') + (parts.length >= 2 && b ? b : '')).toUpperCase()
}

/**
 * One or two letters that fit the compact rail — and no two sounds with the same two.
 *
 * Initials alone are not a name here. The library calls nine of its sounds Coin, Confirm, Crystal,
 * Charge, Chime, Clang, Collapse, Complete and Credit, all of which are "C"; Impact Snap, Impact
 * Strike and Impact Slam are all "IS". The mark is the only thing the forty-eight pixel rail
 * shows, so a mark that fits nine sounds tells you nothing and the rail becomes a row of hover
 * targets. Where two collide, the second takes another letter from its own first word, then a
 * third, and the full name is in the tooltip either way.
 */
const marks = new Map<string, string>()
export function compactMark(label: string): string {
  const kept = marks.get(label)
  if (kept) return kept
  const taken = new Set(marks.values())
  const parts = label.trim().split(/\s+/).filter(Boolean)
  const first = (parts[0] ?? '?').toUpperCase()
  const second = (parts[1] ?? '').toUpperCase()
  // The second word's next letters before the first word's, so Impact Strike stays an I and a
  // letter of Strike rather than becoming two letters of Impact.
  const wanted = [
    initials(label),
    ...Array.from(second.slice(1), (_, at) => first[0] + second.slice(1 + at, 2 + at)),
    ...Array.from(first.slice(1), (_, at) => first[0] + first.slice(1 + at, 2 + at)),
  ]
  const made = wanted.find((one) => one && one.length > 0 && !taken.has(one)) ?? `${first[0] ?? '?'}${taken.size % 10}`
  marks.set(label, made)
  return made
}
