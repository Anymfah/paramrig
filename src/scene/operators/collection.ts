import type { ParameterDef } from '@/rigs/types'
import { collectionById, rootCollection, uniqueName, uniqueObjectName } from '@/scene/document'
import { registerOperator } from '@/scene/operators/registry'
import { selectParam, switchParam, type OperatorContext } from '@/scene/operators/types'
import type { Collection, SceneDocument, SceneObject, SceneSelection } from '@/scene/types'

/**
 * The tree an object lives in.
 *
 * A collection is where an object is filed, not where it is drawn: excluding one takes its objects
 * out of the view, hiding one takes them off the screen, and locking one takes them out of reach of
 * a click, all without touching the objects themselves. The document keeps the tree flat with a
 * `parentId`, under one root that is always the first entry.
 *
 * Every operator here ends with the same invariant, which is why the reseating is written once and
 * shared: every object is in a collection that exists, and no empty stands in for a collection that
 * is gone. An object filed under a deleted collection is not in the outliner and not reachable, and
 * a person cannot get it back — so a delete moves objects rather than orphaning them, always.
 *
 * The collection an operator acts on arrives as a caller-supplied `collectionId` rather than as a
 * field of the F9 panel: the outliner row knows which one was clicked, and there is nothing useful
 * a person could type there. An empty id means the collection the active object is in, which is
 * what running one of these from the viewport rather than from the outliner means.
 */

const NO_SUCH_COLLECTION = 'That collection is not in this document.'
const NEEDS_A_NAME = 'A collection needs a name.'
const ROOT_NOT_DELETABLE = 'The scene collection cannot be deleted.'
const ROOT_NOT_EXCLUDABLE = 'The scene collection cannot be excluded from the view.'
const ROOT_NOT_NESTABLE = 'The scene collection is the top of the tree; it cannot be nested inside another.'

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function withCollections(document: SceneDocument, collections: Collection[]): SceneDocument {
  return { ...document, collections }
}

function nameParam(defaultValue: string): ParameterDef {
  return { kind: 'text', id: 'name', label: 'Name', group: 'operator', defaultValue, maxLength: 80 }
}

/** Everything under a collection, the way `descendantObjectIds` answers the same question of objects. */
function descendantCollectionIds(document: SceneDocument, id: string): string[] {
  const found: string[] = []
  const walk = (parentId: string) => {
    for (const collection of document.collections) {
      if (collection.parentId !== parentId || found.includes(collection.id)) continue
      found.push(collection.id)
      walk(collection.id)
    }
  }
  walk(id)
  return found
}

function resolveCollection(context: OperatorContext, given: string): Collection | null {
  if (given) return collectionById(context.document, given)
  const active = context.active?.collectionId
  return (active ? collectionById(context.document, active) : null) ?? rootCollection(context.document)
}

/**
 * Objects with every pointer at the tree pointing somewhere that exists: one that was filed under a
 * collection that has gone is refiled under `fallbackId`, and an empty standing in for one that has
 * gone becomes an ordinary empty rather than an instance of nothing.
 */
function reseat(objects: SceneObject[], collectionIds: Set<string>, fallbackId: string): SceneObject[] {
  return objects.map((object) => {
    const seated = collectionIds.has(object.collectionId) ? object : { ...object, collectionId: fallbackId }
    if (seated.data.kind !== 'empty' || !seated.data.instanceCollectionId) return seated
    if (collectionIds.has(seated.data.instanceCollectionId)) return seated
    const { instanceCollectionId: _instanceCollectionId, ...data } = seated.data
    return { ...seated, data }
  })
}

function withoutParent(object: SceneObject): SceneObject {
  const { parentId: _parentId, ...rest } = object
  return rest
}

function keptSelection(selection: SceneSelection, deleted: Set<string>): SceneSelection {
  const objectIds = selection.objectIds.filter((id) => !deleted.has(id))
  const active = selection.activeObjectId
  return {
    ...selection,
    objectIds,
    activeObjectId: active !== null && !deleted.has(active) ? active : objectIds.at(-1) ?? null,
  }
}

/* ------------------------------------------------------------ new and name */

registerOperator<{ name: string; parentId: string }>({
  id: 'collection.new',
  label: 'New collection',
  section: 'Collection',
  icon: 'collection',
  description: 'Add an empty collection under another one.',
  params: [nameParam('Collection')],
  defaults: { name: 'Collection', parentId: '' },
  available: () => true,
  run: (context, params) => {
    const parent = resolveCollection(context, params.parentId)
    if (!parent) return { error: NO_SUCH_COLLECTION }
    const name = params.name.trim()
    if (!name) return { error: NEEDS_A_NAME }
    const collection: Collection = {
      id: newId('collection'),
      name: uniqueName(context.document.collections.map((entry) => entry.name), name),
      parentId: parent.id,
    }
    return { document: withCollections(context.document, [...context.document.collections, collection]), label: 'New collection' }
  },
})

registerOperator<{ name: string; collectionId: string }>({
  id: 'collection.rename',
  label: 'Rename collection',
  section: 'Collection',
  icon: 'collection',
  description: 'Give a collection another name.',
  params: [nameParam('Collection')],
  defaults: { name: 'Collection', collectionId: '' },
  available: () => true,
  run: (context, params) => {
    const collection = resolveCollection(context, params.collectionId)
    if (!collection) return { error: NO_SUCH_COLLECTION }
    const name = params.name.trim()
    if (!name) return { error: NEEDS_A_NAME }
    // A name is unique in a document, so a name already taken picks up Blender's suffix rather
    // than being refused: renaming to “Props” when there is a “Props” gives “Props.001”.
    const taken = context.document.collections.filter((entry) => entry.id !== collection.id).map((entry) => entry.name)
    const renamed = uniqueName(taken, name)
    const collections = context.document.collections.map((entry) => (entry.id === collection.id ? { ...entry, name: renamed } : entry))
    return { document: withCollections(context.document, collections), label: 'Rename collection' }
  },
})

/* ---------------------------------------------------------------- deleting */

registerOperator<{ keepObjects: boolean; collectionId: string }>({
  id: 'collection.delete',
  label: 'Delete collection',
  section: 'Collection',
  icon: 'collection',
  description: 'Remove a collection, keeping its objects or taking them with it.',
  params: [switchParam('keepObjects', 'Keep the objects', true)],
  defaults: { keepObjects: true, collectionId: '' },
  available: (context) => (context.document.collections.length > 1 ? true : ROOT_NOT_DELETABLE),
  run: (context, params) => {
    const collection = resolveCollection(context, params.collectionId)
    if (!collection) return { error: NO_SUCH_COLLECTION }
    const root = rootCollection(context.document)
    if (collection.id === root.id) return { error: ROOT_NOT_DELETABLE }
    const parentId = collection.parentId ?? root.id

    if (params.keepObjects) {
      // Everything moves up one: the child collections to the deleted one's parent, and the
      // objects with them, which is what Blender's plain Delete does.
      const collections = context.document.collections
        .filter((entry) => entry.id !== collection.id)
        .map((entry) => (entry.parentId === collection.id ? { ...entry, parentId } : entry))
      const objects = reseat(context.document.objects, new Set(collections.map((entry) => entry.id)), parentId)
      return { document: { ...context.document, collections, objects }, label: 'Delete collection' }
    }

    const removed = new Set([collection.id, ...descendantCollectionIds(context.document, collection.id)])
    const collections = context.document.collections.filter((entry) => !removed.has(entry.id))
    const deleted = new Set(context.document.objects.filter((object) => removed.has(object.collectionId)).map((object) => object.id))
    // A child of a deleted object stays where it is rather than disappearing with its parent, so
    // it is unparented; leaving the id would point at an object that is gone.
    const kept = context.document.objects
      .filter((object) => !deleted.has(object.id))
      .map((object) => (object.parentId && deleted.has(object.parentId) ? withoutParent(object) : object))
    const objects = reseat(kept, new Set(collections.map((entry) => entry.id)), parentId)
    return {
      document: { ...context.document, collections, objects },
      selection: keptSelection(context.selection, deleted),
      label: 'Delete collection and objects',
    }
  },
})

/* ----------------------------------------------------------------- nesting */

registerOperator<{ collectionId: string; intoId: string }>({
  id: 'collection.nest',
  label: 'Nest collection',
  section: 'Collection',
  icon: 'collection',
  description: 'Move a collection under another one.',
  params: [],
  defaults: { collectionId: '', intoId: '' },
  available: (context) => (context.document.collections.length > 2 ? true : 'There is no other collection to nest into.'),
  run: (context, params) => {
    const collection = resolveCollection(context, params.collectionId)
    if (!collection) return { error: NO_SUCH_COLLECTION }
    // No target means the top of the tree: nesting into nothing is how a collection comes back up.
    const into = params.intoId ? collectionById(context.document, params.intoId) : rootCollection(context.document)
    if (!into) return { error: NO_SUCH_COLLECTION }
    if (collection.id === rootCollection(context.document).id) return { error: ROOT_NOT_NESTABLE }
    if (collection.id === into.id) return { error: 'A collection cannot be nested inside itself.' }
    if (descendantCollectionIds(context.document, collection.id).includes(into.id)) {
      return { error: 'A collection cannot be nested inside one of its own descendants.' }
    }
    const collections = context.document.collections.map((entry) => (entry.id === collection.id ? { ...entry, parentId: into.id } : entry))
    return { document: withCollections(context.document, collections), label: 'Nest collection' }
  },
})

/* ------------------------------------------------------------- the switches */

type Flag = 'excluded' | 'hidden' | 'selectable'

/** Whether the restriction is on, which for selection is the absence of the default, not its presence. */
function flagIsOn(collection: Collection, flag: Flag): boolean {
  return flag === 'selectable' ? collection.selectable === false : collection[flag] === true
}

/**
 * The document leaves a flag out when it sits at its default, so an untouched collection stores
 * nothing at all and a stored file stays readable. Turning a restriction off therefore removes the
 * key rather than writing `false`.
 */
function withFlag(collection: Collection, flag: Flag, on: boolean): Collection {
  const next: Collection = { ...collection }
  if (flag === 'selectable') {
    if (on) next.selectable = false
    else delete next.selectable
  } else if (on) {
    next[flag] = true
  } else {
    delete next[flag]
  }
  return next
}

function toggleOperator(id: string, label: string, flag: Flag, description: string, labels: { on: string; off: string }): void {
  registerOperator<{ collectionId: string }>({
    id,
    label,
    section: 'Collection',
    icon: 'collection',
    description,
    params: [],
    defaults: { collectionId: '' },
    available: (context) => (flag !== 'excluded' || context.document.collections.length > 1 ? true : ROOT_NOT_EXCLUDABLE),
    run: (context, params) => {
      const collection = resolveCollection(context, params.collectionId)
      if (!collection) return { error: NO_SUCH_COLLECTION }
      // Blender's outliner gives the scene collection an eye and a cursor but no exclude checkbox:
      // excluding everything is indistinguishable from an empty scene, and there is no way back.
      if (flag === 'excluded' && collection.id === rootCollection(context.document).id) return { error: ROOT_NOT_EXCLUDABLE }
      const on = !flagIsOn(collection, flag)
      const collections = context.document.collections.map((entry) => (entry.id === collection.id ? withFlag(entry, flag, on) : entry))
      return { document: withCollections(context.document, collections), label: on ? labels.on : labels.off }
    },
  })
}

toggleOperator('collection.toggleExclude', 'Exclude from view', 'excluded', 'Take a collection out of the view entirely.', {
  on: 'Exclude collection',
  off: 'Include collection',
})
toggleOperator('collection.toggleHide', 'Hide in viewport', 'hidden', 'Stop drawing a collection without excluding it.', {
  on: 'Hide collection',
  off: 'Show collection',
})
toggleOperator('collection.toggleSelectable', 'Disable selection', 'selectable', 'Leave a collection visible but out of reach of a click.', {
  on: 'Disable selection',
  off: 'Enable selection',
})

/* ------------------------------------------------------------------ colour */

/**
 * Blender's eight colour tags, plus none. They are stored as the colour itself rather than as a tag
 * number so that the outliner has nothing to look up, and they are hues rather than palette tokens
 * because they are a property of the document, not of the interface's theme.
 */
const COLLECTION_COLOURS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'None' },
  { value: '#e2564f', label: 'Red' },
  { value: '#e0813f', label: 'Orange' },
  { value: '#e0c040', label: 'Yellow' },
  { value: '#6ea84f', label: 'Green' },
  { value: '#4f7fd1', label: 'Blue' },
  { value: '#7a5fc2', label: 'Violet' },
  { value: '#cf5f9e', label: 'Pink' },
  { value: '#96694a', label: 'Brown' },
]

registerOperator<{ colour: string; collectionId: string }>({
  id: 'collection.setColour',
  label: 'Set colour',
  section: 'Collection',
  icon: 'collection',
  description: 'Tag a collection with a colour, or take its colour off.',
  params: [selectParam('colour', 'Colour', COLLECTION_COLOURS, 'none')],
  defaults: { colour: 'none', collectionId: '' },
  available: () => true,
  run: (context, params) => {
    const collection = resolveCollection(context, params.collectionId)
    if (!collection) return { error: NO_SUCH_COLLECTION }
    const known = COLLECTION_COLOURS.find((entry) => entry.value === params.colour)
    if (!known) return { error: 'That is not one of the collection colours.' }
    const collections = context.document.collections.map((entry) => {
      if (entry.id !== collection.id) return entry
      const next: Collection = { ...entry }
      if (known.value === 'none') delete next.color
      else next.color = known.value
      return next
    })
    return { document: withCollections(context.document, collections), label: known.value === 'none' ? 'Clear collection colour' : `Colour collection ${known.label.toLowerCase()}` }
  },
})

/* --------------------------------------------------------------- instances */

registerOperator<{ collectionId: string }>({
  id: 'collection.instance',
  label: 'Instance collection',
  section: 'Collection',
  icon: 'collection',
  description: 'Add an empty at the cursor that stands in for a whole collection.',
  params: [],
  defaults: { collectionId: '' },
  available: (context) => (context.document.collections.length > 1 ? true : 'There is no collection to instance.'),
  run: (context, params) => {
    const collection = resolveCollection(context, params.collectionId)
    if (!collection) return { error: NO_SUCH_COLLECTION }
    const active = context.active?.collectionId
    const host = (active && collectionById(context.document, active) ? active : null) ?? rootCollection(context.document).id
    // An empty inside the collection it stands in for would draw itself for ever.
    const inside = new Set([collection.id, ...descendantCollectionIds(context.document, collection.id)])
    if (inside.has(host)) return { error: 'A collection cannot be instanced inside itself.' }
    const [x, y, z] = context.cursor.position
    const object: SceneObject = {
      id: newId('object'),
      name: uniqueObjectName(context.document, collection.name),
      kind: 'empty',
      collectionId: host,
      transform: { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      selectable: true,
      renderable: true,
      data: { kind: 'empty', display: 'plain-axes', size: 1, instanceCollectionId: collection.id },
      modifiers: [],
      materialSlots: [],
    }
    return {
      document: { ...context.document, objects: [...context.document.objects, object] },
      selection: { ...context.selection, objectIds: [object.id], activeObjectId: object.id },
      label: 'Instance collection',
    }
  },
})
