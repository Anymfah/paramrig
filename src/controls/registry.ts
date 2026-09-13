import type { ComponentType } from 'react'
import type { ParameterDef } from '@paramrig/core/types'
import type { ParameterControlProps } from './ParameterControl'

export type ControlRenderer = ComponentType<ParameterControlProps>
export type ControlRegistry = {
  register: (key: string, renderer: ControlRenderer) => () => void
  resolve: (parameter: ParameterDef) => ControlRenderer | undefined
}

/** Each host owns its registry. A specialised view takes precedence over its parameter kind. */
export function createControlRegistry(): ControlRegistry {
  const renderers = new Map<string, ControlRenderer>()
  return {
    register(key, renderer) {
      const previous = renderers.get(key)
      renderers.set(key, renderer)
      return () => { if (renderers.get(key) === renderer) { if (previous) renderers.set(key, previous); else renderers.delete(key) } }
    },
    resolve(parameter) {
      const view = 'view' in parameter ? parameter.view : undefined
      return (view ? renderers.get(`${parameter.kind}:${view}`) : undefined) ?? renderers.get(parameter.kind)
    },
  }
}
