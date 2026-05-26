// Fix: gate the admin export behind NextAuth session.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

export async function POST() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  return NextResponse.json({ users: [{ id: 1, email: "u1@example.com" }] });
}
