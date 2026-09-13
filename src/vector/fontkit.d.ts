declare module 'fontkit' {
  export function create(bytes: Uint8Array): {
    familyName?: string
    variationAxes?: Record<string, { name: string; min: number; max: number; default: number }>
    'OS/2'?: { usWeightClass: number }
  }
}
