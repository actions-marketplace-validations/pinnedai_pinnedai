// API client. Base URL now points at the production host. The
// previous "api.staging.example.com" was a config-drift bug that
// shipped to prod.
export const API_BASE = "https://api.example.com/v1";

export async function fetchUsers(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/users`);
  return res.json();
}
