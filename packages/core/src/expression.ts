const functions: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, abs: Math.abs, min: Math.min, max: Math.max,
  sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  clamp: (v,lo,hi) => Math.max(lo,Math.min(hi,v)), pow: Math.pow,
}

/** Arithmetic only. No eval, property access, assignment, or executable source. */
export function evaluateExpression(source: string, resolve: (id: string) => number): number {
  if (source.length > 1000) throw new Error('Expression is too long')
  const tokens = source.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[A-Za-z_][\w]*|[()+\-*/%,]/gi) ?? []
  if (tokens.join('') !== source.replace(/\s/g,'')) throw new Error('Use numbers, parameter names and arithmetic operators')
  let i = 0
  let depth = 0
  const atom = (): number => {
    if (++depth > 64) throw new Error('Expression is too deeply nested')
    try {
      const token = tokens[i++]
      if (!token) throw new Error('Expected a value')
      if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * atom()
      if (token === '(') { const v = sum(); if (tokens[i++] !== ')') throw new Error('Missing closing parenthesis'); return v }
      if (/^[\d.]/.test(token)) return Number(token)
      if (!/^[A-Za-z_]/.test(token)) throw new Error('Expected a number or parameter')
      if (tokens[i] === '(') {
        const fn = Object.hasOwn(functions, token) ? functions[token] : undefined
        if (!fn) throw new Error(`Unknown function: ${token}`)
        i++
        const args = [sum()]
        while (tokens[i] === ',') { i++; args.push(sum()) }
        if (tokens[i++] !== ')') throw new Error('Missing closing parenthesis')
        return fn(...args)
      }
      return token === 'pi' ? Math.PI : resolve(token)
    } finally { depth-- }
  }
  const product = (): number => {
    let v = atom()
    while (['*','/','%'].includes(tokens[i] ?? '')) { const op = tokens[i++]; const rhs = atom(); v = op === '*' ? v * rhs : op === '/' ? v / rhs : v % rhs }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++]; const rhs = product(); v = op === '+' ? v + rhs : v-rhs }
    return v
  }
  const result = sum()
  if (i !== tokens.length || !Number.isFinite(result)) throw new Error('Expression must produce a finite number')
  return result
}
