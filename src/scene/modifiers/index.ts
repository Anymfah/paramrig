/** Explicit initialization, shared by the editor, viewers and exports. */
import { getModifier, registerModifier } from './types'
import { simpleDeformModifier } from './simpleDeform'
import { arrayModifier } from './array'
import { edgeSplitModifier } from './edgeSplit'
import { smoothModifier } from './smooth'
import { triangulateModifier } from './triangulate'
import { subsurfModifier } from './subsurf'
import { bevelModifier } from './bevel'
import { booleanModifier } from './boolean'
import { weldModifier } from './weld'
import { displaceModifier } from './displace'
import { screwModifier } from './screw'
import { mirrorModifier } from './mirror'
import { decimateModifier } from './decimate'
import { castModifier } from './cast'
import { solidifyModifier } from './solidify'
import { wireframeModifier } from './wireframe'

export function initializeBuiltinModifiers(): void {
  if (!getModifier(simpleDeformModifier.kind)) registerModifier(simpleDeformModifier)
  if (!getModifier(arrayModifier.kind)) registerModifier(arrayModifier)
  if (!getModifier(edgeSplitModifier.kind)) registerModifier(edgeSplitModifier)
  if (!getModifier(smoothModifier.kind)) registerModifier(smoothModifier)
  if (!getModifier(triangulateModifier.kind)) registerModifier(triangulateModifier)
  if (!getModifier(subsurfModifier.kind)) registerModifier(subsurfModifier)
  if (!getModifier(bevelModifier.kind)) registerModifier(bevelModifier)
  if (!getModifier(booleanModifier.kind)) registerModifier(booleanModifier)
  if (!getModifier(weldModifier.kind)) registerModifier(weldModifier)
  if (!getModifier(displaceModifier.kind)) registerModifier(displaceModifier)
  if (!getModifier(screwModifier.kind)) registerModifier(screwModifier)
  if (!getModifier(mirrorModifier.kind)) registerModifier(mirrorModifier)
  if (!getModifier(decimateModifier.kind)) registerModifier(decimateModifier)
  if (!getModifier(castModifier.kind)) registerModifier(castModifier)
  if (!getModifier(solidifyModifier.kind)) registerModifier(solidifyModifier)
  if (!getModifier(wireframeModifier.kind)) registerModifier(wireframeModifier)
}

export { getModifier, listModifiers, modifierCount, type ModifierCategory, type ModifierModule } from './types'
