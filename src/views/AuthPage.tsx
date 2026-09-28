import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarBlank, CheckCircle, EnvelopeSimple, Eye, EyeSlash, LockKey, ShieldCheck, User } from "@phosphor-icons/react";
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
    <main className="entry-screen">
      <header className="entry-header">
        <div className="brand-mark"><BrandIcon size={32} /><span>SaveYoRupee</span></div>
      </header>
      <div className="entry-body">
        <section className="entry-story" aria-label="What SaveYoRupee helps you see">
          <div className="entry-story-inner">
            <h1>See the whole month.</h1>
            <div className="entry-picture" role="img" aria-label="Money in and money out together make up your monthly view">
              <div className="entry-picture-source"><span className="entry-picture-icon"><ArrowDown size={34} weight="regular" aria-hidden="true" /></span><span>Money in</span></div>
              <ArrowRight className="entry-picture-link" size={25} aria-hidden="true" />
              <div className="entry-picture-month"><span className="entry-picture-icon"><CalendarBlank size={42} weight="regular" aria-hidden="true" /></span><span>Your month</span></div>
              <ArrowLeft className="entry-picture-link" size={25} aria-hidden="true" />
              <div className="entry-picture-source"><span className="entry-picture-icon"><ArrowUp size={34} weight="regular" aria-hidden="true" /></span><span>Money out</span></div>
            </div>
          </div>
        </section>

        <section className="entry-panel" aria-labelledby="entry-title">
          <div className="entry-form-wrap">
            <div>
              <h2 id="entry-title">{mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Choose a new password"}</h2>
              <p>{mode === "signin" ? "Sign in to see your money." : mode === "signup" ? "You can add your first entry later." : "Use at least eight characters."}</p>
            </div>

            <form onSubmit={submit} className="entry-form">
              {mode === "signup" && <TextInput size="md" label="Your name" leftSection={<User size={20} aria-hidden="true" />} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="e.g. Suman Karki" />}
              {mode !== "new-password" && <TextInput size="md" label="Email address" type="email" leftSection={<EnvelopeSimple size={20} aria-hidden="true" />} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="e.g. suman@example.com" />}
              <PasswordInput
                size="md"
                label={mode === "new-password" ? "New password" : "Password"}
                leftSection={<LockKey size={20} aria-hidden="true" />}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                placeholder={mode === "signin" ? "Enter your password" : "At least 8 characters"}
                visible={showPassword}
                onVisibilityChange={setShowPassword}
                classNames={{ innerInput: "entry-password-input", visibilityToggle: "auth-password-toggle" }}
                visibilityToggleButtonProps={{
                  "aria-label": showPassword ? "Hide password" : "Show password",
                  title: showPassword ? "Hide password" : "Show password",
                  tabIndex: 0,
                }}
                visibilityToggleIcon={({ reveal }) => reveal ? <EyeSlash size={19} /> : <Eye size={19} />}
              />
              {mode === "new-password" && <PasswordInput size="md" label="Confirm new password" leftSection={<LockKey size={20} aria-hidden="true" />} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} minLength={8} autoComplete="new-password" required placeholder="Enter it again" disabled={submitting} />}
              {mode === "signin" && <button type="button" className="text-button entry-forgot" onClick={() => { setError(null); setRecoveryResetOpen(true); }}>Forgot password?</button>}
              {error && <div className="form-error" role="alert">{error}</div>}
              {message && <div className="form-success"><CheckCircle size={18} weight="fill" />{message}</div>}
              <button className="primary-button entry-submit" disabled={submitting}>{submitting ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Update password"}</button>
              {mode === "signup" && <p className="entry-recovery-note"><ShieldCheck size={20} aria-hidden="true" />Next, set up recovery.</p>}
            </form>

            <div className="entry-switch">
              {mode === "signin" && <>New here? <button className="text-button" onClick={() => switchMode("signup")}>Create an account</button></>}
              {mode === "signup" && <>Already have an account? <button className="text-button" onClick={() => switchMode("signin")}>Sign in</button></>}
              {mode === "new-password" && <button className="text-button" onClick={() => switchMode("signin")}>Back to sign in</button>}
            </div>
          </div>
        </section>
      </div>
      <RecoverySetupModal
        opened={recoverySetupOpen}
        onClose={() => setRecoverySetupOpen(false)}
        cancelLabel="Back to sign-up"
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
