import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { SceneDocument, World } from '@/scene/types'
import { BarField } from '@/ui/BarField'
import { ColorField } from '@/ui/ColorField'

/**
 * The World tab: what the scene sits in. For now that is one colour and how brightly it shines,
 * which is what lights an object that no lamp reaches; an environment image joins them later.
 */
export function WorldPanel({ world, onEditDocument, onGestureStart, onGestureEnd, isOpen, onSection }: {
  world: World
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const edit = (patch: Partial<World>, label: string) => {
    onEditDocument((current) => ({ ...current, world: { ...current.world, ...patch } }), label)
  }

  return (
    <SceneSection id="world-surface" title="Surface" isOpen={isOpen} onSection={onSection}>
      <ColorField
        label="Background"
        value={world.color}
        onChange={(color) => edit({ color }, 'World colour')}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
      <BarField
        label="Strength"
        value={world.strength}
        min={0}
        max={10}
        sliderMax={2}
        step={0.01}
        onChange={(strength) => edit({ strength }, 'World strength')}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
      <SceneEmpty>The background lights whatever no lamp reaches, so a dark world leaves the shadows dark.</SceneEmpty>
    </SceneSection>
  )
}
