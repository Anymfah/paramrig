import { evaluateExpression, normalizeValue } from '@paramrig/core'; if (evaluateExpression('2 + 3', () => 0) !== 5) throw Error('Expression failed'); export const result = normalizeValue;
console.log('core: public API completed successfully')
