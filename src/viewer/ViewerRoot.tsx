import { AuthProvider, useAuth } from "../auth";
import { LoginPage } from "../components/LoginPage";

// UX-level gate only. The REAL enforcement is the Firestore security rules,
// which reject any read whose auth token isn't this verified email — the client
// cannot grant itself access by editing this constant.
const AUTHORIZED_EMAIL = "maxiredigonda@gmail.com";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
      {children}
    </div>
  );
}

function Gate() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <Centered>
        <p className="text-sm text-ink-faint">Loading…</p>
      </Centered>
    );
  }

  if (user == null) {
    return <LoginPage />;
  }

  if (user.email !== AUTHORIZED_EMAIL) {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">Not authorized</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          <span className="font-medium text-ink">{user.email}</span> can't access
          this data. Sign in with the owner's Google account.
        </p>
        <button
          onClick={() => void signOut()}
          className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Sign out
        </button>
      </Centered>
    );
  }

  // Authenticated as the owner. Data rendering from Firestore is the next step;
  // this confirms the gate works end-to-end.
  return (
    <Centered>
      <h1 className="font-serif text-3xl font-medium">execute</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        Signed in as <span className="font-medium text-ink">{user.email}</span>.
        Your tasks will appear here once cloud sync is wired up.
      </p>
      <button
        onClick={() => void signOut()}
        className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
      >
        Sign out
      </button>
    </Centered>
  );
}

export function ViewerRoot() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
