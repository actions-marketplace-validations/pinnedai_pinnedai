// Buggy: Next.js app-router route with NO session check.
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ users: [{ id: 1, email: "u1@example.com" }] });
}
