/**
 * Firestore-safe serialization.
 *
 * Firestore rejects `undefined` values anywhere in a document. This helper
 * recursively removes undefined object properties and array elements while
 * preserving null, numbers, strings, booleans, and nested structures.
 */
export function sanitizeFirestoreData<T = any>(value: T): T {
  const sanitize = (input: any): any => {
    if (input === undefined) return undefined;
    if (input === null) return null;

    if (Array.isArray(input)) {
      return input
        .map(sanitize)
        .filter((item) => item !== undefined);
    }

    if (typeof input === 'object') {
      const output: Record<string, any> = {};
      for (const [key, child] of Object.entries(input)) {
        const cleaned = sanitize(child);
        if (cleaned !== undefined) output[key] = cleaned;
      }
      return output;
    }

    return input;
  };

  return sanitize(value) as T;
}
