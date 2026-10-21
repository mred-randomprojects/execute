import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { clearCloudCache, firebaseAuth } from "./firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
/** How long sign-out waits for the offline cache to be deleted before reloading anyway. */
const CLEAR_TIMEOUT_MS = 3_000;
const googleProvider = new GoogleAuthProvider();

/** The web viewer's sign-in. `afterSignOut` defaults to reloading the page. */
export function AuthProvider({
  children,
  afterSignOut = () => window.location.reload(),
}: {
  children: ReactNode;
  afterSignOut?: () => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth(), (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async () => {
    await signInWithPopup(firebaseAuth(), googleProvider);
  }, []);

  // Signing out leaves Firestore's offline copy of the data in IndexedDB, on
  // the origin every app of the account shares: clear it too, then reload,
  // since the SDK can't be used after clearing (and the page starts clean).
  // Deleting the database waits while another tab still has it open, so the
  // reload doesn't wait for it forever.
  const signOut = useCallback(async () => {
    await firebaseSignOut(firebaseAuth());
    try {
      await Promise.race([
        clearCloudCache(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("clearing took too long (another tab may have it open)")), CLEAR_TIMEOUT_MS),
        ),
      ]);
    } catch (e: unknown) {
      console.error("Signed out, but the offline copy of the data couldn't be cleared", e);
    }
    afterSignOut();
  }, [afterSignOut]);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
