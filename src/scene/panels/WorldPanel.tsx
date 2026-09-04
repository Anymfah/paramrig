import { ResourceField } from '@/scene/panels/ResourceField'
import { Exposable } from '@/scene/SceneExpose'
import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { SceneDocument, World } from '@/scene/types'
import { BarField } from '@/ui/BarField'
import { ColorField } from '@/ui/ColorField'
import { SwitchField } from '@/ui/SwitchField'

/**
 * The World tab: what the scene sits in.
 *
 * A colour and a strength light whatever no lamp reaches. An environment image replaces both with a
 * photograph of a real place, which is how a surface gets something worth reflecting — and lighting
 * a scene with one and seeing it behind the objects are two separate switches, as they are in
 * Blender: a product shot is lit by a room it never shows.
 *
 * The image is a project resource rather than a path, so a document carries a reference and the
 * bytes stay in this browser. A missing one leaves the colour lighting the scene rather than the
 * scene unlit.
 */

/** What a browser can decode as an environment. Radiance files are read by three's own loader. */
const ENVIRONMENT_TYPES = '.hdr,image/png,image/jpeg,image/webp'

export function WorldPanel({ world, onEditDocument, onGestureStart, onGestureEnd, isOpen, onSection }: {
  world: World
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const folds = { isOpen, onSection }
  const gesture = { onGestureStart, onGestureEnd }
  const edit = (patch: Partial<World>, label: string) => {
    onEditDocument((current) => ({ ...current, world: { ...current.world, ...patch } }), label)
  }
  const fog = world.fog ?? { enabled: false, density: 0.02, color: world.color }
  const hasEnvironment = typeof world.environmentId === 'string' && world.environmentId !== ''

  return (
    <>
      <SceneSection id="world-surface" title="Surface" {...folds}>
        <Exposable property="world.color">
          <ColorField
            label="Background"
            value={world.color}
            onChange={(color) => edit({ color }, 'World colour')}
            {...gesture}
          />
        </Exposable>
        <Exposable property="world.strength" min={0} max={10} step={0.01}>
          <BarField
            label="Strength"
            value={world.strength}
            min={0}
            max={10}
            sliderMax={2}
            step={0.01}
            onChange={(strength) => edit({ strength }, 'World strength')}
            {...gesture}
          />
        </Exposable>
        <SceneEmpty>The background lights whatever no lamp reaches, so a dark world leaves the shadows dark.</SceneEmpty>
      </SceneSection>

      <SceneSection
        id="world-environment"
        title="Environment"
        meta={hasEnvironment ? world.environmentName ?? 'Image' : undefined}
        {...folds}
      >
        <ResourceField
          label="Environment image"
          accept={ENVIRONMENT_TYPES}
          hint="HDR · PNG · JPEG · WebP, up to 64 MB"
          maxMB={64}
          name={hasEnvironment ? world.environmentName ?? 'Environment image' : null}
          onChoose={(resource) => edit(
            { environmentId: resource.id, environmentName: resource.name, useForLighting: world.useForLighting ?? true },
            'World environment',
          )}
          onClear={() => edit({ environmentId: null, environmentName: '' }, 'Remove environment')}
        />
        {hasEnvironment ? (
          <>
            <BarField
              label="Strength"
              value={world.environmentStrength ?? 1}
              min={0}
              max={20}
              sliderMax={4}
              step={0.01}
              defaultValue={1}
              onChange={(environmentStrength) => edit({ environmentStrength }, 'Environment strength')}
              {...gesture}
            />
            <BarField
              label="Rotation"
              value={degrees(world.environmentRotation ?? 0)}
              min={-360}
              max={360}
              step={1}
              unit="°"
              defaultValue={0}
              onChange={(value) => edit({ environmentRotation: (value * Math.PI) / 180 }, 'Environment rotation')}
              {...gesture}
            />
            <SwitchField
              label="Use for lighting"
              checked={world.useForLighting ?? true}
              defaultValue
              onChange={(useForLighting) => edit({ useForLighting }, 'Environment lighting')}
            />
            <SwitchField
              label="Visible as background"
              checked={world.visibleAsBackground ?? true}
              defaultValue
              onChange={(visibleAsBackground) => edit({ visibleAsBackground }, 'Environment background')}
            />
          </>
        ) : (
          <SceneEmpty>An equirectangular image — a Radiance .hdr, or a PNG or JPEG — lights the scene and gives its surfaces something to reflect.</SceneEmpty>
        )}
      </SceneSection>

      <SceneSection id="world-fog" title="Fog" meta={fog.enabled ? 'On' : undefined} {...folds}>
        <SwitchField
          label="Fog"
          checked={fog.enabled}
          defaultValue={false}
          onChange={(enabled) => edit({ fog: { ...fog, enabled } }, enabled ? 'Fog on' : 'Fog off')}
        />
        <BarField
          label="Density"
          value={fog.density}
          min={0}
          max={1}
          sliderMax={0.2}
          step={0.001}
          disabled={!fog.enabled}
          defaultValue={0.02}
          onChange={(density) => edit({ fog: { ...fog, density } }, 'Fog density')}
          {...gesture}
        />
        <ColorField
          label="Colour"
          value={fog.color}
          onChange={(color) => edit({ fog: { ...fog, color } }, 'Fog colour')}
          {...gesture}
        />
        <SceneEmpty>Fog thickens with distance in the rendered view, and takes its colour from itself rather than from the background.</SceneEmpty>
      </SceneSection>
    </>
  )
}

function degrees(radians: number): number {
  return Math.round(((radians * 180) / Math.PI) * 10) / 10
}
