import { controlId } from '@/rigs/binding'
import type { ParameterDef, ParamGroup } from '@/rigs/types'
import {
  emptySceneRig,
  parameterForSceneProperty,
  parseSceneProperty,
  scenePropertyLabel,
  type SceneBinding,
  type SceneRig,
} from '@/scene/rig'
import type { SceneDocument } from '@/scene/types'

/**
 * The edits a person makes to a rig, as pure functions of the document.
 *
 * Exposing a field, unbinding it, adding a control that drives nothing yet, renaming one, moving it
 * to another group, deleting it — each is a document in and a document out, so the panel that calls
 * them holds no state of its own and the history records them like any other edit.
 */

export type ExposeRequest = {
  objectId?: string
  property: string
  label: string
  group: string
  newGroupLabel?: string
  min?: number
  max?: number
  step?: number
}

/** The rig a document has, or the empty one it would start from. */
export function rigOf(document: SceneDocument): SceneRig {
  return document.rig ?? emptySceneRig()
}

/**
 * A field turned into a control.
 *
 * The control takes its default from what the scene says today and its bounds from whatever
 * declared them, so a subdivision exposed at level two starts at two and stops at six. A property
 * that is already driven is bound again rather than twice: the last binding wins, so a second one
 * would be a control that silently does nothing.
 */
export function exposeProperty(document: SceneDocument, request: ExposeRequest): { document: SceneDocument; parameterId: string } | null {
  const path = parseSceneProperty(request.property)
  if (!path) return null
  if (path.scoped && !request.objectId) return null
  const rig = rigOf(document)
  const groups = withGroup(rig.groups, request.group, request.newGroupLabel)
  const taken = new Set(rig.parameters.map((parameter) => parameter.id))
  const id = controlId(request.label, taken)
  const parameter = parameterForSceneProperty({
    id,
    label: request.label,
    group: request.group,
    document,
    binding: { objectId: request.objectId, property: request.property },
    ...(request.min === undefined ? {} : { min: request.min }),
    ...(request.max === undefined ? {} : { max: request.max }),
    ...(request.step === undefined ? {} : { step: request.step }),
  })
  if (!parameter) return null
  const binding: SceneBinding = {
    id: `binding-${crypto.randomUUID()}`,
    ...(request.objectId && path.scoped ? { objectId: request.objectId } : {}),
    ...(path.kind === 'material' ? { materialId: path.materialId } : {}),
    property: request.property,
    parameterId: id,
  }
  return {
    document: {
      ...document,
      rig: {
        ...rig,
        groups,
        parameters: [...rig.parameters, parameter],
        bindings: [...rig.bindings.filter((entry) => !sameTarget(entry, binding)), binding],
      },
    },
    parameterId: id,
  }
}

/** Two bindings write to the same place when their object and their property agree. */
function sameTarget(a: SceneBinding, b: SceneBinding): boolean {
  return a.property === b.property && (a.objectId ?? null) === (b.objectId ?? null)
}

/** The groups, with the one a request named added if it is new. */
function withGroup(groups: ParamGroup[], id: string, label?: string): ParamGroup[] {
  if (groups.some((group) => group.id === id)) return groups
  return [...groups, { id, label: label ?? id }]
}

/**
 * A control taken off a property. The control itself stays: a person who unbinds a field usually
 * means to bind it elsewhere, and a control that vanished with its last binding would take its
 * value and its keyframes with it.
 */
export function unbindProperty(document: SceneDocument, bindingId: string): SceneDocument {
  const rig = document.rig
  if (!rig) return document
  return { ...document, rig: { ...rig, bindings: rig.bindings.filter((binding) => binding.id !== bindingId) } }
}

/** A control that drives nothing yet, for a rig built from the controls down. */
export function addControl(document: SceneDocument, parameter: ParameterDef): SceneDocument {
  const rig = rigOf(document)
  const taken = new Set(rig.parameters.map((entry) => entry.id))
  const id = taken.has(parameter.id) ? controlId(parameter.label, taken) : parameter.id
  return {
    ...document,
    rig: {
      ...rig,
      groups: withGroup(rig.groups, parameter.group),
      parameters: [...rig.parameters, { ...parameter, id }],
    },
  }
}

/** One control's own settings changed: its name, its group, its bounds. */
export function updateControl(document: SceneDocument, parameterId: string, patch: Partial<ParameterDef>): SceneDocument {
  const rig = document.rig
  if (!rig) return document
  return {
    ...document,
    rig: {
      ...rig,
      groups: patch.group ? withGroup(rig.groups, patch.group) : rig.groups,
      parameters: rig.parameters.map((parameter) => (
        parameter.id === parameterId ? ({ ...parameter, ...patch } as ParameterDef) : parameter
      )),
    },
  }
}

/**
 * A control removed, and every binding that named it with it. Leaving the bindings would leave the
 * document carrying instructions that point at nothing, which the file reader would drop anyway.
 */
export function removeControl(document: SceneDocument, parameterId: string): SceneDocument {
  const rig = document.rig
  if (!rig) return document
  return {
    ...document,
    rig: {
      ...rig,
      parameters: rig.parameters.filter((parameter) => parameter.id !== parameterId),
      bindings: rig.bindings.filter((binding) => binding.parameterId !== parameterId),
    },
  }
}

/** A control dropped on a field: the same as exposing it, with the control already chosen. */
export function bindExisting(document: SceneDocument, parameterId: string, target: { objectId?: string; property: string }): SceneDocument {
  const rig = document.rig
  const path = parseSceneProperty(target.property)
  if (!rig || !path) return document
  if (path.scoped && !target.objectId) return document
  if (!rig.parameters.some((parameter) => parameter.id === parameterId)) return document
  const binding: SceneBinding = {
    id: `binding-${crypto.randomUUID()}`,
    ...(target.objectId && path.scoped ? { objectId: target.objectId } : {}),
    ...(path.kind === 'material' ? { materialId: path.materialId } : {}),
    property: target.property,
    parameterId,
  }
  return {
    ...document,
    rig: { ...rig, bindings: [...rig.bindings.filter((entry) => !sameTarget(entry, binding)), binding] },
  }
}

/** What a fresh control is called when it is added from the Controls tab rather than from a field. */
export function suggestedLabel(document: SceneDocument, binding: { objectId?: string; property: string }): string {
  return scenePropertyLabel(document, binding)
}
