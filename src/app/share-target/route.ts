import { NextResponse } from "next/server";

// The service worker (public/sw.js) answers shares on the device. A share reaches the server only
// when no worker is running yet (the first launch after installing, or an outdated worker), so
// the body is left unread and the app explains that the share should be sent again.
export function POST(request: Request) {
  return NextResponse.redirect(new URL("/?share=failed", request.url), 303);
}

export function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url), 303);
}
