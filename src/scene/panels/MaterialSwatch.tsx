import { useMemo } from 'react'
import type { Material } from '@/scene/types'
import { materialPreview } from '@/scene/viewport/preview'

/**
 * A material, drawn as the sphere it would make.
 *
 * Shared by the Material tab and the asset list, because they are showing the same thing and a
 * second implementation would drift: half of what a material is — roughness, metal, transmission —
 * is invisible in a flat square of its base colour, and two materials that differ only in roughness
 * would be indistinguishable in a list.
 *
 * Where there is no WebGL the render is null and a disc of the base colour stands in, which is
 * still better than nothing and never blocks a panel from rendering.
 */
export function MaterialSwatch({ material }: { material: Material | null }) {
  const preview = useMemo(() => (material ? materialPreview(material) : null), [material])
  if (!material) return <span className="scene-swatch" data-empty="" aria-hidden="true" />
  return preview
    ? <img className="scene-swatch" src={preview} alt="" width={24} height={24} />
    : <span className="scene-swatch" style={{ background: material.baseColor }} aria-hidden="true" />
}
