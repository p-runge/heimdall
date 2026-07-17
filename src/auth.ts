import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db";
import { users } from "@/db/schema";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN!;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.email_verified || profile.hd !== ALLOWED_DOMAIN) return false;

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
