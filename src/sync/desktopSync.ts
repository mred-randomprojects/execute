import { GoogleAuthProvider, signInWithCredential, type User } from "firebase/auth";
import { auth } from "../firebase";
import { getState } from "../store/store";
import { saveAppState } from "../viewer/cloud";

const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;
const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET;

function bridge() {
  return typeof window !== "undefined" ? window.execute : undefined;
}

/**
 * Sync is offered only in the desktop app (the loopback OAuth needs the main
 * process) and only when a Google desktop OAuth client is configured. In the
 * browser / web viewer, or before the client id is set, this is false and the
 * UI hides itself.
 */
export function syncAvailable(): boolean {
  const b = bridge();
  return (
    b?.isElectron === true &&
    typeof b.signInWithGoogle === "function" &&
    Boolean(clientId) &&
    Boolean(clientSecret)
  );
}

async function ensureSignedIn(): Promise<User> {
  if (auth.currentUser != null) return auth.currentUser;
  const b = bridge();
  if (b?.signInWithGoogle == null) throw new Error("Desktop sign-in is unavailable here.");
  if (!clientId || !clientSecret) {
    throw new Error("Missing VITE_GOOGLE_DESKTOP_CLIENT_ID / VITE_GOOGLE_DESKTOP_CLIENT_SECRET.");
  }
  const { idToken } = await b.signInWithGoogle(clientId, clientSecret);
  const result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return result.user;
}

/**
 * One-way push: sign in if needed, then overwrite the single cloud document with
 * the current AppState. Desktop is the sole writer, so a whole-doc replace is
 * correct and needs no merge — the web mirror just reflects it read-only.
 */
export async function pushNow(): Promise<{ email: string | null }> {
  const user = await ensureSignedIn();
  await saveAppState(user.uid, getState());
  return { email: user.email };
}
