import { NextRequest, NextResponse } from "next/server";

const ALLOWED_STORAGE_HOSTS = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com"
]);

function isAllowedFirebaseStorageUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (!ALLOWED_STORAGE_HOSTS.has(parsed.hostname)) return false;

    const configuredBucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "").trim();
    if (!configuredBucket) return true;

    const bucketFromPath = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\//)?.[1] || "";
    if (bucketFromPath && bucketFromPath !== configuredBucket) return false;

    const bucketFromQuery = parsed.searchParams.get("bucket");
    if (bucketFromQuery && bucketFromQuery !== configuredBucket) return false;

    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { audioDownloadUrl?: unknown };
    const audioDownloadUrl =
      typeof body.audioDownloadUrl === "string" ? body.audioDownloadUrl.trim() : "";

    if (!audioDownloadUrl) {
      return NextResponse.json(
        { error: "Missing audioDownloadUrl." },
        { status: 400 }
      );
    }
    if (!isAllowedFirebaseStorageUrl(audioDownloadUrl)) {
      return NextResponse.json(
        { error: "Only Firebase Storage URLs are allowed." },
        { status: 400 }
      );
    }

    const upstream = await fetch(audioDownloadUrl, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Audio download failed (${upstream.status}).` },
        { status: upstream.status }
      );
    }

    const audioBuffer = await upstream.arrayBuffer();
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/webm",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load saved recording." },
      { status: 500 }
    );
  }
}
