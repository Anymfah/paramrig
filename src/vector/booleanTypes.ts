export const BOOLEAN_OPERATIONS = ['unite', 'subtract', 'intersect', 'exclude'] as const
export type BooleanOperation = typeof BOOLEAN_OPERATIONS[number]
