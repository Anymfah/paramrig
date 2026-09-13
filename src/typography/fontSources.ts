export function googleCssUrl(family: string, weights: number[]): string {
  const list = [...new Set(weights.length ? weights : [400])].sort((a, b) => a - b).join(';')
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${list}&display=swap`
}

/**
 * The file URL for one weight out of a Google Fonts stylesheet.
 *
 * The stylesheet carries a block per subset, each preceded by a comment naming it. The latin one
 * is what a drawing tool wants; without it, the first block will do.
 */
export function pickFontFileUrl(css: string, weight?: number): string | null {
  const blocks = [...css.matchAll(/\/\*\s*([^*]+?)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)]
    .map((match) => ({ subset: match[1] ?? '', body: match[2] ?? '' }))
  const candidates = blocks.length ? blocks : [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => ({ subset: '', body: match[1] ?? '' }))
  const weighted = weight
    ? candidates.filter((block) => new RegExp(`font-weight:\\s*${weight}\\b`).test(block.body))
    : candidates
  const pool = weighted.length ? weighted : candidates
  const latin = pool.find((block) => block.subset === 'latin') ?? pool[0]
  return latin?.body.match(/url\(([^)]+)\)/)?.[1] ?? null
}
