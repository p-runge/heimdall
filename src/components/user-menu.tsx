import { auth } from "@/auth";
import { signOutAction } from "@/lib/auth-actions";
import { UserMenuDropdown } from "@/components/user-menu-dropdown";

export async function UserMenu() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <UserMenuDropdown
      name={session.user.name ?? null}
      email={session.user.email ?? null}
      image={session.user.image ?? null}
      onSignOut={signOutAction}
    />
  );
}
