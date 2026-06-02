// auth module barrel. Re-exports signIn alongside the rest — fixes
// the parent commit's bug where `import { signIn } from "./auth"`
// resolved to undefined at runtime.
export { signIn } from "./signIn.js";
export { signOut } from "./signOut.js";
export { useAuth } from "./useAuth.js";
