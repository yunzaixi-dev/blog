/** @param {string|undefined} input @param {number} fallback */
export function portNumber(input, fallback) {
  const value = input === undefined ? fallback : Number(input)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid server port')
  return value
}
