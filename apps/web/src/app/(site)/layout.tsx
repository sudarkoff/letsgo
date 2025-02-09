"use client";

import Navbar from "../../components/Navbar";
import Link from "next/link";
import { useUser } from "@auth0/nextjs-auth0/client";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useUser();

  return (
    <div>
      <Navbar>
        <div>
          <Link href="/">Home</Link> • <Link href="/pricing">Pricing</Link> • 
          <Link href="/contact">Contact</Link> • 
          <a href="/manage">{user ? "Manage" : "Login"}</a>
          {user && (
            <span>
              {" "}
              •{" "}
              <a href={`/api/auth/logout?returnTo=${window.location.pathname}`}>
                Logout
              </a>
            </span>
          )}
        </div>
      </Navbar>
      {children}
    </div>
  );
}
