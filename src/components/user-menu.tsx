import { auth, signOut } from "@/auth";

export async function UserMenu() {
  const session = await auth();
  if (!session?.user) return null;

  const label = session.user.name ?? session.user.email ?? "";

  return (
    <div className="flex items-center gap-3 text-sm text-mist-300">
      <span className="max-w-[10rem] truncate" title={session.user.email ?? undefined}>
        {label}
      </span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="hover:text-mist-100 transition-colors">
          Sign out
        </button>
      </form>
    </div>
  );
}
