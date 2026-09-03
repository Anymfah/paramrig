import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as sceneIcons from '@/scene/icons'
import { SCENE_ICONS, sceneIcon } from '@/scene/iconRegistry'
import type {
  LightKind,
  PivotPoint,
  SceneObjectKind,
  SceneTool,
  SelectMode,
  ShadingMode,
  TransformOrientation,
} from '@/scene/types'

const registered = Object.entries(SCENE_ICONS)

/*
 * The vocabulary tables below are typed as records over the document's own unions, so leaving a
 * member out is a compile error rather than a button that silently loses its icon.
 */
const TOOL_ICONS: Record<SceneTool, string> = {
  'select-box': 'select-box',
  'select-circle': 'select-circle',
  'select-lasso': 'select-lasso',
  cursor: 'cursor',
  move: 'move',
  rotate: 'rotate',
  scale: 'scale',
  transform: 'transform',
  annotate: 'annotate',
  measure: 'measure',
  extrude: 'extrude',
  inset: 'inset',
  bevel: 'bevel',
  'loop-cut': 'loop-cut',
  knife: 'knife',
  bisect: 'bisect',
  'poly-build': 'poly-build',
  spin: 'spin',
  smooth: 'smooth',
  'edge-slide': 'edge-slide',
  'shrink-fatten': 'shrink-fatten',
  shear: 'shear',
  rip: 'rip',
}

const SELECT_MODE_ICONS: Record<SelectMode, string> = {
  vertex: 'vertex-mode',
  edge: 'edge-mode',
  face: 'face-mode',
}

const SHADING_ICONS: Record<ShadingMode, string> = {
  wireframe: 'shading-wireframe',
  solid: 'shading-solid',
  material: 'shading-material',
  rendered: 'shading-rendered',
}

const PIVOT_ICONS: Record<PivotPoint, string> = {
  'bounding-box': 'pivot-bounding-box',
  cursor: 'pivot-cursor',
  individual: 'pivot-individual',
  median: 'pivot-median',
  active: 'pivot-active',
}

const ORIENTATION_ICONS: Record<TransformOrientation, string> = {
  global: 'orientation-global',
  local: 'orientation-local',
  normal: 'orientation-normal',
  gimbal: 'orientation-gimbal',
  view: 'orientation-view',
  cursor: 'orientation-cursor',
}

const LIGHT_ICONS: Record<LightKind, string> = {
  point: 'light-point',
  sun: 'light-sun',
  spot: 'light-spot',
  area: 'light-area',
}

const OBJECT_KIND_ICONS: Record<SceneObjectKind, string> = {
  mesh: 'mesh',
  light: 'light-point',
  camera: 'camera',
  empty: 'empty',
  curve: 'curve',
  text: 'text',
}

describe('the scene editor icon set', () => {
  it.each(registered)('draws %s as one silent sixteen-unit square', (name, Icon) => {
    const { container } = render(<Icon />)
    const svg = container.firstElementChild

    expect(svg?.tagName.toLowerCase(), name).toBe('svg')
    expect(svg?.getAttribute('aria-hidden'), name).toBe('true')
    expect(svg?.getAttribute('focusable'), name).toBe('false')
    expect(svg?.getAttribute('viewBox'), name).toBe('0 0 16 16')
  })

  it.each(registered)('draws %s with the house stroke and no filled ground', (name, Icon) => {
    const { container } = render(<Icon />)
    const svg = container.firstElementChild

    expect(svg?.getAttribute('fill'), name).toBe('none')
    expect(svg?.getAttribute('stroke'), name).toBe('currentColor')
    expect(svg?.getAttribute('stroke-width'), name).toBe('1.5')
    expect(svg?.getAttribute('stroke-linecap'), name).toBe('round')
    expect(svg?.getAttribute('stroke-linejoin'), name).toBe('round')
  })

  it.each(registered)('spells %s out of shapes rather than a letter or a picture', (name, Icon) => {
    const { container } = render(<Icon />)
    const svg = container.firstElementChild

    expect(svg?.querySelector('text'), name).toBeNull()
    expect(svg?.querySelector('tspan'), name).toBeNull()
    expect(svg?.querySelector('image'), name).toBeNull()
    expect(svg?.textContent, name).toBe('')
  })

  it('passes a class name through to the drawing', () => {
    const { container } = render(<sceneIcons.IconExtrude className="scene-toolbar__icon" />)
    expect(container.firstElementChild).toHaveClass('scene-toolbar__icon')
  })

  it('draws something for every icon it registers', () => {
    expect(registered.length).toBeGreaterThan(80)
    for (const [name, Icon] of registered) {
      const { container } = render(<Icon />)
      expect(container.firstElementChild?.children.length, name).toBeGreaterThan(0)
    }
  })

  it('registers every icon it draws, so nothing is drawn and then forgotten', () => {
    const drawn = Object.entries(sceneIcons).filter(([name]) => name.startsWith('Icon'))
    const known = new Set<unknown>(Object.values(SCENE_ICONS))

    expect(drawn.length).toBeGreaterThan(80)
    expect(drawn.filter(([, icon]) => !known.has(icon)).map(([name]) => name)).toEqual([])
  })
})

describe('looking an icon up by name', () => {
  it('finds the icon an operator names', () => {
    expect(sceneIcon('loop-cut')).toBe(sceneIcons.IconLoopCut)
    expect(sceneIcon('pivot-cursor')).toBe(sceneIcons.IconPivotCursor)
  })

  it('forgives the spelling an operator was written with', () => {
    expect(sceneIcon('IconLoopCut')).toBe(sceneIcons.IconLoopCut)
    expect(sceneIcon('loopCut')).toBe(sceneIcons.IconLoopCut)
    expect(sceneIcon('loop_cut')).toBe(sceneIcons.IconLoopCut)
    expect(sceneIcon('Shrink Fatten')).toBe(sceneIcons.IconShrinkFatten)
  })

  it('comes back empty for an operator that names no icon at all', () => {
    expect(sceneIcon(undefined)).toBeNull()
    expect(sceneIcon('')).toBeNull()
    expect(sceneIcon('a-tool-nobody-has-drawn-yet')).toBeNull()
  })

  it('does not reach through to a property every object has', () => {
    expect(sceneIcon('constructor')).toBeNull()
    expect(sceneIcon('toString')).toBeNull()
    expect(sceneIcon('__proto__')).toBeNull()
  })
})

describe('the names the editor already has words for', () => {
  it('covers every tool the view can be holding', () => {
    for (const [tool, name] of Object.entries(TOOL_ICONS)) {
      expect(sceneIcon(name), tool).not.toBeNull()
    }
  })

  it('covers every selection mode, shading mode and light', () => {
    for (const table of [SELECT_MODE_ICONS, SHADING_ICONS, LIGHT_ICONS]) {
      for (const [member, name] of Object.entries(table)) {
        expect(sceneIcon(name), member).not.toBeNull()
      }
    }
  })

  it('covers every pivot point and transform orientation', () => {
    for (const table of [PIVOT_ICONS, ORIENTATION_ICONS]) {
      for (const [member, name] of Object.entries(table)) {
        expect(sceneIcon(name), member).not.toBeNull()
      }
    }
  })

  it('covers every kind of object the outliner lists', () => {
    for (const [kind, name] of Object.entries(OBJECT_KIND_ICONS)) {
      expect(sceneIcon(name), kind).not.toBeNull()
    }
  })
})
