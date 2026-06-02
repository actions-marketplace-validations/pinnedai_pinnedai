// parse() — implicit-any on `data`. With strict + noImplicitAny on,
// tsc --noEmit fails: TS7006 Parameter 'data' implicitly has an
// 'any' type. Caught at build time; ships breakage if not.
export function parse(data) {
  return JSON.parse(data);
}
