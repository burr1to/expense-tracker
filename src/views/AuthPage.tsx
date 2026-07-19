import { ArrowRight, ChartLineUp, CheckCircle, Eye, EyeSlash } from "@phosphor-icons/react";
import { PasswordInput, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { BrandIcon } from "../components/BrandIcon";
import { useAuth } from "../context/AuthContext";

type AuthMode = "signin" | "signup" | "reset" | "new-password";

export function AuthPage() {
  const { signIn, signUp, resetPassword, completePasswordReset } = useAuth();
  const [resetToken, setResetToken] = useState("");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) { setResetToken(token); setMode("new-password"); }
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signin") await signIn(email, password);
      if (mode === "signup") setMessage(await signUp(name, email, password));
      if (mode === "reset") {
        await resetPassword(email);
        setMessage("Password reset instructions are on the way.");
      }
      if (mode === "new-password") {
        if (!resetToken) throw new Error("This reset link is missing its token.");
        await completePasswordReset(resetToken, password);
        window.history.replaceState({}, "", "/");
        setPassword(""); setMode("signin"); setMessage("Password updated. You can sign in now.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: AuthMode) => { setMode(next); setError(null); setMessage(null); };

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand-mark"><BrandIcon /><span>SaveYoRupee</span></div>
        <div>
          <span className="eyebrow light">Personal finance, clearly told</span>
          <h1>Know where your money went, and what stayed.</h1>
          <p>Log the everyday. Understand the month. Keep your financial picture beautifully simple.</p>
          <div className="story-metric"><ChartLineUp size={34} weight="duotone" /><div><strong>One calm view</strong><span>Income, spending and savings without the noise.</span></div></div>
        </div>
        <small>Your data stays private to your account.</small>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">Welcome to SaveYoRupee</span>
          <h2>{mode === "signin" ? "Sign in to your ledger" : mode === "signup" ? "Create your ledger" : mode === "new-password" ? "Choose a new password" : "Reset your password"}</h2>
          <p>{mode === "signin" ? "Pick up where you left off." : mode === "signup" ? "A clean money habit starts here." : mode === "new-password" ? "Use at least eight characters." : "We’ll email you a secure reset link."}</p>

          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && <TextInput label="Your name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="Suman" />}
            {mode !== "new-password" && <TextInput label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />}
            {(mode !== "reset") && (
              <PasswordInput
                label="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                placeholder="At least 8 characters"
                visible={showPassword}
                onVisibilityChange={setShowPassword}
                classNames={{ innerInput: "auth-password-input", visibilityToggle: "auth-password-toggle" }}
                visibilityToggleButtonProps={{
                  "aria-label": showPassword ? "Hide password" : "Show password",
                  title: showPassword ? "Hide password" : "Show password",
                  tabIndex: 0,
                }}
                visibilityToggleIcon={({ reveal }) => reveal ? <EyeSlash size={19} /> : <Eye size={19} />}
              />
            )}
            {mode === "signin" && <button type="button" className="text-button align-right" onClick={() => switchMode("reset")}>Forgot password?</button>}
            {error && <div className="form-error" role="alert">{error}</div>}
            {message && <div className="form-success"><CheckCircle size={18} weight="fill" />{message}</div>}
            <button className="primary-button full-width" disabled={submitting}>{submitting ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "new-password" ? "Update password" : "Send reset link"}<ArrowRight size={19} /></button>
          </form>

          <div className="auth-switch">
            {mode === "signin" && <>New here? <button className="text-button" onClick={() => switchMode("signup")}>Create an account</button></>}
            {mode === "signup" && <>Already have an account? <button className="text-button" onClick={() => switchMode("signin")}>Sign in</button></>}
            {mode === "reset" && <button className="text-button" onClick={() => switchMode("signin")}>Back to sign in</button>}
          </div>
        </div>
      </section>
    </main>
  );
}
