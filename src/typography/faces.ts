/** Families offered in the inspector. Shipped families can also be outlined. */
export type TextFace = {
  value: string
  label: string
  /** CSS font stack used for measuring, on the canvas and in exports. */
  stack: string
  /** A font file the app ships, so "Outline text" can read its glyphs. */
  outline?: boolean
  /** Locally served webfont and its supported weight range, for self-contained exports. */
  webFont?: boolean
  weights?: number[]
}

export const TEXT_FACES: TextFace[] = [
  { value: 'Public Sans', label: 'Public Sans', stack: "'Public Sans', 'Public Sans Fallback', ui-sans-serif, sans-serif", outline: true, webFont: true, weights: [100, 900] },
  { value: 'Space Grotesk', label: 'Space Grotesk', stack: "'Space Grotesk', sans-serif", outline: true, webFont: true, weights: [300, 700] },
  { value: 'Source Serif 4', label: 'Source Serif 4', stack: "'Source Serif 4', serif", outline: true, webFont: true, weights: [200, 900] },
  { value: 'Helvetica', label: 'Helvetica / Arial', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { value: 'Verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { value: 'Trebuchet MS', label: 'Trebuchet', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { value: 'Georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { value: 'Times New Roman', label: 'Times', stack: "'Times New Roman', Times, serif" },
  { value: 'Courier New', label: 'Courier', stack: "'Courier New', Courier, monospace" },
  { value: 'Menlo', label: 'Menlo / Consolas', stack: "Menlo, Consolas, 'Liberation Mono', monospace" },
]
