/**
 * How a material travels from the asset list to the viewport.
 *
 * A custom MIME type rather than plain text, so that a drop knows the difference between a material
 * being dragged out of the panel and any other text a browser might carry. The constant lives on
 * its own because the two ends of the gesture are in different components, and a string typed twice
 * is a gesture that stops working for no visible reason.
 */
export const MATERIAL_DRAG_TYPE = 'application/x-paramrig-material'

/** The material id a drag is carrying, or null when it is carrying something else. */
export function draggedMaterialId(transfer: DataTransfer | null): string | null {
  if (!transfer) return null
  const id = transfer.getData(MATERIAL_DRAG_TYPE)
  return id === '' ? null : id
}

/** Whether a drag in progress is a material, which can be told before it is dropped. */
export function isMaterialDrag(transfer: DataTransfer | null): boolean {
  return !!transfer && [...transfer.types].includes(MATERIAL_DRAG_TYPE)
}
