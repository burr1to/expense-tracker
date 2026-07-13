import App from "../App";
import { AuthProvider } from "../context/AuthContext";
import { LedgerProvider } from "../context/LedgerContext";

export const dynamic = "force-dynamic";

export default function Home() {
  return <AuthProvider><LedgerProvider><App /></LedgerProvider></AuthProvider>;
}
