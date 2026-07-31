import { ArrowRight, ChartLineUp, CheckCircle, Eye, EyeSlash } from "@phosphor-icons/react";
import { PasswordInput, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { BrandIcon } from "../components/BrandIcon";
import { RecoveryResetModal } from "../components/RecoveryResetModal";
import { RecoverySetupModal } from "../components/RecoverySetupModal";
import { useAuth } from "../context/AuthContext";

type AuthMode = "signin" | "signup" | "new-password";

export function AuthPage() {
  const { signIn, signUp, completePasswordReset, verifyRecovery, resetRecoveryPassword } = useAuth();
  const [resetToken, setResetToken] = useState("");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoverySetupOpen, setRecoverySetupOpen] = useState(false);
  const [recoveryResetOpen, setRecoveryResetOpen] = useState(false);

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
      if (mode === "signup") { setRecoverySetupOpen(true); return; }
      if (mode === "new-password") {
        if (!resetToken) throw new Error("This reset link is missing its token.");
        if (password !== confirmPassword) throw new Error("The new passwords do not match.");
        await completePasswordReset(resetToken, password);
        window.history.replaceState({}, "", "/");
        setPassword(""); setConfirmPassword(""); setMode("signin"); setMessage("Password updated. You can sign in now.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: AuthMode) => { setMode(next); setError(null); setMessage(null); setConfirmPassword(""); };

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
          <h2>{mode === "signin" ? "Sign in to your ledger" : mode === "signup" ? "Create your ledger" : "Choose a new password"}</h2>
          <p>{mode === "signin" ? "Pick up where you left off." : mode === "signup" ? "A clean money habit starts here." : "Use at least eight characters."}</p>

          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && <TextInput size="sm" label="Your name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="Suman" />}
            {mode !== "new-password" && <TextInput size="sm" label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />}
            <PasswordInput
                size="sm"
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
            {mode === "new-password" && <PasswordInput size="sm" label="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} minLength={8} autoComplete="new-password" required placeholder="Enter it again" disabled={submitting} />}
            {mode === "signin" && <button type="button" className="text-button align-right" onClick={() => { setError(null); setRecoveryResetOpen(true); }}>Forgot password?</button>}
            {error && <div className="form-error" role="alert">{error}</div>}
            {message && <div className="form-success"><CheckCircle size={18} weight="fill" />{message}</div>}
            <button className="primary-button full-width" disabled={submitting}>{submitting ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Update password"}<ArrowRight size={19} /></button>
          </form>

          <div className="auth-switch">
            {mode === "signin" && <>New here? <button className="text-button" onClick={() => switchMode("signup")}>Create an account</button></>}
            {mode === "signup" && <>Already have an account? <button className="text-button" onClick={() => switchMode("signin")}>Sign in</button></>}
          </div>
        </div>
      </section>
      <RecoverySetupModal
        opened={recoverySetupOpen}
        onClose={() => setRecoverySetupOpen(false)}
        onSave={async (setup) => {
          setSubmitting(true);
          setError(null);
          try {
            await signUp(name, email, password, setup);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not create your account.");
            throw caught;
          } finally {
            setSubmitting(false);
          }
        }}
      />
      <RecoveryResetModal
        opened={recoveryResetOpen}
        onClose={() => setRecoveryResetOpen(false)}
        onVerify={verifyRecovery}
        onReset={resetRecoveryPassword}
        onComplete={() => { setMessage("Password updated. You can sign in now."); setError(null); }}
      />
    </main>
  );
}
