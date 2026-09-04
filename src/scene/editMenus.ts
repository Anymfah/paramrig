/**
 * The edit-mode menus, as lists of operator ids.
 *
 * They are lists rather than components because the same list is used twice: once by the header,
 * where Blender puts the Vertex, Edge and Face menus, and once at the pointer, where ⌃V, ⌃E and ⌃F
 * open the same thing. Written twice they would drift apart within a week.
 *
 * `menuEntries` drops an id no family registered, so a list may name an operator that arrives in a
 * later prompt: the menu fills itself in as the families land, and never shows a dead entry.
 */

export type MenuIds = Array<string | '-'>

export const EDIT_VIEW_MENU: MenuIds = [
  'view.frameSelected', 'view.frameAll', '-',
  'view.front', 'view.back', 'view.right', 'view.left', 'view.top', 'view.bottom', '-',
  'view.opposite', 'view.togglePerspective',
]

export const EDIT_SELECT_MENU: MenuIds = [
  'mesh.selectAll', 'mesh.selectNone', 'mesh.selectInvert', '-',
  'select.box', 'select.circle', 'select.lasso', '-',
  'mesh.selectMore', 'mesh.selectLess', '-',
  'mesh.selectLoop', 'mesh.selectRing', 'mesh.selectLinked', 'mesh.selectBoundary', '-',
  'mesh.selectSimilar', 'mesh.selectByTrait', 'mesh.selectSide', 'mesh.selectMirror', '-',
  'mesh.selectRandom', 'mesh.selectCheckerDeselect',
]

export const MESH_MENU: MenuIds = [
  'transform.move', 'transform.rotate', 'transform.scale', '-',
  'mesh.shrinkFatten', 'mesh.pushPull', 'mesh.shear', 'mesh.toSphere', 'mesh.randomize', '-',
  'mesh.mergeByDistance', 'mesh.splitSelection', 'mesh.separate', '-',
  'mesh.bisect', 'mesh.knife', 'mesh.knifeProject', '-',
  'mesh.symmetrize', 'mesh.snapToSymmetry', 'mesh.mirror', '-',
  'mesh.normalsRecalculate', 'mesh.normalsFlip', 'mesh.autoSmooth', '-',
  'mesh.shadeSmooth', 'mesh.shadeFlat', '-',
  'mesh.deleteLoose', 'mesh.decimate', 'mesh.degenerateDissolve', 'mesh.dissolveLimited',
  'mesh.makePlanar', 'mesh.splitNonPlanar', 'mesh.splitConcave', 'mesh.fillHoles', 'mesh.convexHull', '-',
  'mesh.deleteVertices',
]

export const VERTEX_MENU: MenuIds = [
  'mesh.extrudeVertices', 'mesh.bevelVertices', 'mesh.fill', '-',
  'mesh.rip', 'mesh.ripFill', 'mesh.vertexSlide', '-',
  'mesh.smoothVertices', 'mesh.laplacianSmooth', '-',
  'mesh.mergeAtCentre', 'mesh.mergeAtCursor', 'mesh.mergeCollapse', 'mesh.mergeByDistance', '-',
  'mesh.dissolveVertices', 'mesh.convexHull',
]

export const EDGE_MENU: MenuIds = [
  'mesh.extrudeEdges', 'mesh.bevelEdges', 'mesh.bridgeEdgeLoops', '-',
  'mesh.subdivide', 'mesh.unsubdivide', 'mesh.subdivideEdgeRing', '-',
  'mesh.loopCut', 'mesh.offsetEdgeLoop', 'mesh.edgeSlide', '-',
  'mesh.rotateEdge', 'mesh.edgeSplit', 'mesh.edgeSplitBySharp', '-',
  'mesh.markSeam', 'mesh.clearSeam', 'mesh.markSharp', 'mesh.clearSharp', '-',
  'mesh.setCrease', 'mesh.setBevelWeight', '-',
  'mesh.dissolveEdges', 'mesh.dissolveEdgeLoops', 'mesh.dissolveEdgeCollapse',
]

export const FACE_MENU: MenuIds = [
  'mesh.extrudeRegion', 'mesh.extrudeAlongNormals', 'mesh.extrudeIndividual', 'mesh.extrudeManifold', '-',
  'mesh.inset', 'mesh.poke', 'mesh.triangulate', 'mesh.trisToQuads', '-',
  'mesh.solidify', 'mesh.wireframe', 'mesh.intersectKnife', 'mesh.booleanIntersect', '-',
  'mesh.fill', 'mesh.beautyFill', 'mesh.gridFill', 'mesh.weldEdges', '-',
  'mesh.shadeSmooth', 'mesh.shadeFlat', '-',
  'mesh.splitFacesByEdges', 'mesh.dissolveFaces',
]

/* --------------------------------------------------- the menus at the pointer */

export const EXTRUDE_MENU: MenuIds = [
  'mesh.extrudeRegion', 'mesh.extrudeAlongNormals', 'mesh.extrudeIndividual', 'mesh.extrudeManifold', '-',
  'mesh.extrudeEdges', 'mesh.extrudeVertices', 'mesh.extrudeToCursor', 'mesh.extrudeRepeat',
]

export const MERGE_MENU: MenuIds = [
  'mesh.mergeAtCentre', 'mesh.mergeAtCursor', 'mesh.mergeCollapse', '-',
  'mesh.mergeAtFirst', 'mesh.mergeAtLast', '-',
  'mesh.mergeByDistance',
]

export const DELETE_MENU: MenuIds = [
  'mesh.deleteVertices', 'mesh.deleteEdges', 'mesh.deleteFaces', '-',
  'mesh.deleteOnlyEdgesFaces', 'mesh.deleteOnlyFaces', '-',
  'mesh.dissolveVertices', 'mesh.dissolveEdges', 'mesh.dissolveFaces', '-',
  'mesh.dissolveLimited', 'mesh.dissolveEdgeCollapse',
]

export const SPLIT_MENU: MenuIds = [
  'mesh.splitSelection', 'mesh.splitEdgesFaces', 'mesh.splitFacesByEdges',
]

export const SEPARATE_MENU: MenuIds = ['mesh.separate']

export const NORMALS_MENU: MenuIds = [
  'mesh.normalsRecalculate', 'mesh.normalsFlip', '-',
  'mesh.normalsSetFromFaces', 'mesh.normalsPointToTarget', 'mesh.normalsAverage', '-',
  'mesh.autoSmooth',
]

/** Which list a `menu.*` action opens, and what its heading says. */
/** The U menu: everything that makes or moves a UV map, in the order Blender lists them. */
/**
 * The UV editor's own menu, which is a different list from the one U opens in the viewport.
 *
 * U is about *making* a map — unwrap, project, pack — and this is about moving one that exists.
 * Blender divides them the same way and for the same reason: what is selected is different in the
 * two places, so the operators that read a selection are different too.
 */
export const UV_EDIT_MENU: MenuIds = [
  'uv.pin', 'uv.unpin', '-',
  'uv.weld', 'uv.stitch', '-',
  'uv.align', 'uv.straighten', 'uv.mirror', '-',
  'uv.snapToPixels', 'uv.constrainToImage', '-',
  'uv.packIslands', 'uv.averageIslandScale', 'uv.minimizeStretch', '-',
  'uv.seamsFromIslands',
]

export const UV_MENU: MenuIds = [
  'uv.unwrap', 'uv.smartProject', 'uv.lightmapPack', '-',
  'uv.cubeProject', 'uv.cylinderProject', 'uv.sphereProject', 'uv.projectFromView', '-',
  'uv.reset', '-',
  'uv.packIslands', 'uv.averageIslandScale', 'uv.minimizeStretch', '-',
  'mesh.markSeam', 'mesh.clearSeam', 'uv.seamsFromIslands',
]

export const POINTER_MENUS: Record<string, { title: string; ids: MenuIds }> = {
  'menu.uv': { title: 'UV mapping', ids: UV_MENU },
  'menu.extrude': { title: 'Extrude', ids: EXTRUDE_MENU },
  'menu.merge': { title: 'Merge', ids: MERGE_MENU },
  'menu.delete': { title: 'Delete', ids: DELETE_MENU },
  'menu.split': { title: 'Split', ids: SPLIT_MENU },
  'menu.separate': { title: 'Separate', ids: SEPARATE_MENU },
  'menu.normals': { title: 'Normals', ids: NORMALS_MENU },
  'menu.vertex': { title: 'Vertex', ids: VERTEX_MENU },
  'menu.edge': { title: 'Edge', ids: EDGE_MENU },
  'menu.face': { title: 'Face', ids: FACE_MENU },
}
