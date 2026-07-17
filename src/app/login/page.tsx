import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Callout, Panel } from "@/components/ui";
import { Logo } from "@/components/logo";

function errorMessage(error?: string) {
  if (error === "AccessDenied") {
    return `Access is restricted to @${process.env.ALLOWED_EMAIL_DOMAIN} Google accounts.`;
  }
  if (error) return "Something went wrong signing you in. Please try again.";
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const { next, error } = await searchParams;
  const message = errorMessage(error);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-8 px-6 py-24">
      <Logo />
      <Panel className="w-full text-center">
        <h1 className="font-display text-xl text-mist-100">Sign in to Heimdall</h1>
        <p className="mt-2 text-sm text-mist-400">
          Restricted to @{process.env.ALLOWED_EMAIL_DOMAIN} Google accounts.
        </p>
        {message && (
          <div className="mt-4">
            <Callout tone="crimson">{message}</Callout>
          </div>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: next ?? "/" });
          }}
        >
          <button
            type="submit"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md aurora-gradient px-4 py-2 text-sm font-medium text-void hover:brightness-110 transition-colors"
          >
            Sign in with Google
          </button>
        </form>
      </Panel>
    </div>
  );
}
