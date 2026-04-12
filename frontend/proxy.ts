import { NextRequest, NextResponse } from "next/server";

const PUBLIC_ROUTES = ["/login"];

const ROLE_HOME: Record<string, string> = {
  teacher: "/teacher",
  admin: "/admin",
};

const ROLE_ALLOWED_PREFIXES: Record<string, string[]> = {
  student: ["/student", "/business-analytics", "/business-analytics/graph"],
  teacher: ["/teacher", "/student"],
  admin: ["/admin", "/teacher", "/student"],
};

function getRoleHome(role: string, course?: string) {
  if (role === "student") {
    return course === "business_analytics" ? "/business-analytics" : "/student";
  }
  return ROLE_HOME[role] ?? "/login";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth_token")?.value;
  const role = request.cookies.get("user_role")?.value;
  const course = request.cookies.get("user_course")?.value;

  if (!token || !role) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/") {
    const home = getRoleHome(role, course);
    return NextResponse.redirect(new URL(home, request.url));
  }

  if (
    role === "student" &&
    course === "business_analytics" &&
    pathname.startsWith("/student")
  ) {
    return NextResponse.redirect(new URL("/business-analytics", request.url));
  }

  const allowedPrefixes = ROLE_ALLOWED_PREFIXES[role] ?? [];
  const isAllowed = allowedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (!isAllowed) {
    const home = getRoleHome(role, course);
    return NextResponse.redirect(new URL(home, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts|icons|images).*)",
  ],
};