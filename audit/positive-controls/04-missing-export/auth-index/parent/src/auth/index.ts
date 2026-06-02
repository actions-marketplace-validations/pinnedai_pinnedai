// auth module barrel. The fixed version re-exports signIn (and the
// rest). This parent version forgot — consumers importing { signIn }
// from "./auth" would get undefined and fail at runtime.
export { signOut } from "./signOut.js";
export { useAuth } from "./useAuth.js";
