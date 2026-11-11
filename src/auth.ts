import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "@/env";
import { db } from "@/db";
import { users } from "@/db/schema";

function isAllowed(email: string, hostedDomain: unknown) {
  if (env.ALLOWED_EMAIL_DOMAIN && hostedDomain === env.ALLOWED_EMAIL_DOMAIN) return true;
  return env.ALLOWED_EMAILS.includes(email.toLowerCase());
}

// The `hd` hint narrows Google's account chooser to the Workspace domain. It
// is left out when individual addresses are allowed too, since those may live
// outside that domain. It is passed per sign-in rather than in the provider
// config, because this module is evaluated during `next build`, where env
// validation is skipped and ALLOWED_EMAILS is not yet parsed into an array.
export function hostedDomainHint(): Record<string, string> {
  return env.ALLOWED_EMAIL_DOMAIN && env.ALLOWED_EMAILS.length === 0
    ? { hd: env.ALLOWED_EMAIL_DOMAIN }
    : {};
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.email_verified || !profile.email) return false;
      if (!isAllowed(profile.email, profile.hd)) return false;

      await db
        .insert(users)
        .values({
          googleSub: profile.sub!,
          email: profile.email!,
          name: profile.name,
          avatarUrl: profile.picture as string | undefined,
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.googleSub,
          set: {
            email: profile.email!,
            name: profile.name,
            avatarUrl: profile.picture as string | undefined,
            lastLoginAt: new Date(),
          },
        });

      return true;
    },
  },
});
