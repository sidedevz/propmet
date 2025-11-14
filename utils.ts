/**
 * JSON replacer function that handles BigInt values during serialization.
 *
 * BigInt values cannot be directly serialized by JSON.stringify() - they throw
 * a TypeError. This replacer converts BigInt values to a special string marker
 * that can be identified and processed later.
 *
 * @param _ - The key (unused)
 * @param value - The value being stringified
 * @returns The original value or a BigInt marker string
 */
function jsonStringifyReplacerForBigInt(_: string, value: any) {
  if (typeof value === "bigint") {
    // Return a special marker that we can identify and replace later
    return `__BIGINT__${value.toString()}__BIGINT__`;
  }
  return value;
}

/**
 * Stringify an object to JSON with proper BigInt support.
 *
 * JavaScript's native JSON.stringify() cannot handle BigInt values and will
 * throw a TypeError when encountering them. This function provides a workaround
 * by:
 *
 * 1. Using a custom replacer to convert BigInt values to special marker strings
 * 2. Performing the JSON stringification with these markers
 * 3. Post-processing the result to remove quotes around the markers, leaving
 *    the BigInt values as unquoted numbers in the final JSON
 *
 * This is particularly useful when sending data to systems like Kafka that
 * expect numeric values to be unquoted in JSON payloads.
 *
 * @param obj - The object to stringify
 * @param space - Optional spacing for pretty-printing
 * @returns JSON string with BigInt values properly serialized as numbers
 */
export function JSONStringifyWithBigInt(obj: any, space?: number) {
  const jsonString = JSON.stringify(obj, jsonStringifyReplacerForBigInt, space);
  // Remove quotes around our BigInt markers
  return jsonString.replace(/"__BIGINT__(-?\d+)__BIGINT__"/g, "$1");
}
