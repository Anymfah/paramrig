import { describe, it } from 'vitest'
import { sample } from '@/scene/textures/procedural'
import type { Vec3 } from '@/scene/types'

describe('measure', () => {
  it('max nearest distance', () => {
    let highest = 0
    let over1 = 0
    let over12 = 0
    const total = 400000
    for (let index = 0; index < total; index += 1) {
      const point: Vec3 = [index * 0.0137, index * 0.0219 - 3, index * 0.0331 + 7]
      const d = sample('voronoi', point, { detail: 1 }) * 8
      highest = Math.max(highest, d)
      if (d > 1) over1 += 1
      if (d > 1.2) over12 += 1
    }
    console.log('max', highest, 'over 1:', over1 / total, 'over 1.2:', over12 / total)
  })
})
