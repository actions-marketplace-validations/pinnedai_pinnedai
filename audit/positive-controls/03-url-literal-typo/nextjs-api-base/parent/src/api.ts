// API client. Wrong base URL pointing at the staging host — every
// prod fetch would route to staging and either 404 or hit the wrong
// dataset.
export const API_BASE = "https://api.staging.example.com/v1";

export async function fetchUsers(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/users`);
  return res.json();
}
