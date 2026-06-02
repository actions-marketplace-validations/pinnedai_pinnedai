// parse() — `data` now annotated as string, satisfying noImplicitAny.
// tsc --noEmit passes clean. Pin asserts subsequent commits don't
// regress this back to an implicit any.
export function parse(data: string): unknown {
  return JSON.parse(data);
}
