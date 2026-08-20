import { Show, useClerk, useUser } from "@clerk/react";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export function AccountControls() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [, setLocation] = useLocation();

  return (
    <>
      <Show when="signed-out">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setLocation("/sign-in")}
          data-testid="button-sign-in"
        >
          <LogIn className="h-4 w-4" />
          <span className="hidden sm:inline">Sign in for alerts</span>
        </Button>
      </Show>
      <Show when="signed-in">
        <div className="flex items-center gap-2">
          <span className="hidden max-w-36 truncate text-xs text-muted-foreground md:inline">
            {user?.primaryEmailAddress?.emailAddress ?? "Signed in"}
          </span>
          <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL })}
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </Show>
    </>
  );
}