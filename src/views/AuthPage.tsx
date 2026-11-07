import { CheckCircle, Eye, EyeSlash, ShieldCheck } from "@phosphor-icons/react";
import { PasswordInput, TextInput } from "@mantine/core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RecoveryResetModal } from "../components/RecoveryResetModal";
import { RecoverySetupModal } from "../components/RecoverySetupModal";
import { SlidingTabs } from "../components/SlidingTabs";
import { useAuth } from "../context/AuthContext";
import { FormError } from "../components/FormError";

type AuthMode = "signin" | "signup" | "new-password";

const modeTabs = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
] as const;

// The form is plain English for everyone; the Nepali fun lives on the green side.
const copy: Record<AuthMode, { title: string; lede: string; submit: string; busy: string }> = {
  signin: { title: "Welcome back", lede: "Your entries waited for you. Unlike your salary.", submit: "Sign in", busy: "Opening your ledger…" },
  signup: { title: "Start your ledger", lede: "Takes a minute. Your first momo can wait.", submit: "Continue", busy: "One moment…" },
  "new-password": { title: "Choose a new password", lede: "At least eight characters. Not your phone number.", submit: "Update password", busy: "Updating…" },
};

/** Lines that roll under the headline. The first repeats at the end so the loop has no jump. */
const TICKER = [
  "Salary aayo. Salary gayo. Kata?",
  "Momo ma kati gayo? Let's count.",
  "eSewa, Khalti, Cash. Sabai ek thau.",
  "Dashain ko kharcha, minus the panic.",
];

const STICKERS: { text: string; bg: string; ink: string; tilt: number }[] = [
  { text: "Momo budget: ∞", bg: "#fde5d4", ink: "#b4531f", tilt: -6 },
  { text: "Dashain mode: ON", bg: "#fbe0ec", ink: "#b0386a", tilt: 4 },
  { text: "eSewa ✓  Khalti ✓  Cash ✓", bg: "#d9f1dd", ink: "#1f7a35", tilt: -3 },
  { text: "BS dates. Obviously.", bg: "#fdf0c4", ink: "#8a5a00", tilt: 5 },
  { text: "Sapati tracker: Bhai, 2,000, since Asar", bg: "#ece2f8", ink: "#5c2d91", tilt: -4 },
  { text: "Chiya: 60 × 30 = ouch", bg: "#dcecf8", ink: "#1f6f9a", tilt: 3 },
];

/** Friendlier words for the two sign-in failures people actually hit. */
function friendlyError(message: string, mode: AuthMode) {
  if (mode === "signin" && /invalid (email|password)|email or password/i.test(message)) return "That email and password didn't match. Try again. We forget things too.";
  if (mode === "signup" && /already exists|already registered|user exists/i.test(message)) return "That email already has a ledger. Sign in instead?";
  return message;
}

function Sticker({ text, bg, ink, tilt, index }: (typeof STICKERS)[number] & { index: number }) {
  return <span className="syr-sticker" style={{ "--sticker-bg": bg, "--sticker-ink": ink, "--sticker-tilt": `${tilt}deg`, "--sticker-delay": `${-index * 0.9}s` } as CSSProperties}>{text}</span>;
}

/** A 500-rupee note with flapping wings, leaving. */
function FlyingNote({ className }: { className?: string }) {
  return (
    <svg className={`syr-note ${className ?? ""}`} viewBox="0 0 120 80" aria-hidden="true">
      <path className="syr-wing" d="M38 30 C20 6, 4 10, 2 22 C14 20, 22 26, 30 34 Z" />
      <path className="syr-wing" d="M82 30 C100 6, 116 10, 118 22 C106 20, 98 26, 90 34 Z" />
      <rect x="24" y="30" width="72" height="40" rx="5" fill="#c9e7a7" stroke="#2c5a1e" strokeWidth="2" />
      <rect x="30" y="36" width="60" height="28" rx="3" fill="none" stroke="#2c5a1e" strokeWidth="1.2" strokeDasharray="3 3" />
      <circle cx="60" cy="50" r="9" fill="#e6f4d4" stroke="#2c5a1e" strokeWidth="1.5" />
      <text x="60" y="54.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#2c5a1e" fontFamily="Mukta, sans-serif">रु</text>
      <text x="33" y="44" fontSize="7" fontWeight="700" fill="#2c5a1e">500</text>
      <text x="76" y="64" fontSize="7" fontWeight="700" fill="#2c5a1e">500</text>
    </svg>
  );
}

function StickerWall() {
  return (
    <aside className="syr-wall" aria-label="What SaveYoRupee does">
      <div className="syr-brand"><span className="syr-mark" aria-hidden="true">रु</span>SaveYoRupee</div>
      <div className="syr-headline">
        <span className="syr-eyebrow">Your money, explained</span>
        <h2><span lang="ne" className="syr-deva">हिसाब <em>किताब</em>,</span><span className="syr-latin">bina tension.</span></h2>
        <p className="visually-hidden">Hisab kitab, bina tension: your accounts, without the stress.</p>
        <span className="syr-ticker" aria-hidden="true"><span>{[...TICKER, TICKER[0]].map((line, index) => <span key={index}>{line}</span>)}</span></span>
      </div>
      <div className="syr-stickers is-floating" aria-hidden="true">{STICKERS.slice(0, 3).map((sticker, index) => <Sticker key={sticker.text} {...sticker} index={index} />)}</div>
      <div className="syr-stickers is-resting" aria-hidden="true">{STICKERS.slice(3).map((sticker, index) => <Sticker key={sticker.text} {...sticker} index={index + 3} />)}</div>
      <FlyingNote className="is-big" />
      <FlyingNote className="is-small" />
    </aside>
  );
}

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
  const copyRef = useRef<HTMLDivElement>(null);
  const text = copy[mode];

  useEffect(() => {
    const block = copyRef.current;
    if (!block) return;
    block.classList.remove("is-hiding");
    block.classList.remove("is-shown");
    void block.offsetHeight;
    block.classList.add("is-shown");
  }, [mode]);

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
      setError(friendlyError(caught instanceof Error ? caught.message : "Something went wrong.", mode));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: AuthMode) => { setMode(next); setError(null); setMessage(null); setConfirmPassword(""); };

  return (
    <main className="entry-screen syr-entry">
      <StickerWall />
      <section className="syr-panel" aria-labelledby="entry-title">
        <div className="syr-card">
          {mode !== "new-password" && (
            <SlidingTabs label="Sign in or create an account" value={mode} onChange={switchMode} options={modeTabs} className="entry-tabs syr-tabs" disabled={submitting} />
          )}

          <div ref={copyRef} className="t-stagger entry-copy syr-copy">
            <h1 id="entry-title" className="t-stagger-line t-stagger-line--1">{text.title}</h1>
            <p className="t-stagger-line t-stagger-line--2">{text.lede}</p>
          </div>

          <form onSubmit={submit} className="entry-form syr-form">
            {mode === "signup" && <TextInput size="md" label="Your name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="Suman Karki" />}
            {mode !== "new-password" && <TextInput size="md" label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />}
            <div className="entry-password-field">
              <PasswordInput
                size="md"
                label={mode === "new-password" ? "New password" : "Password"}
                description={mode === "signin" ? undefined : "At least 8 characters"}
                inputWrapperOrder={["label", "input", "description", "error"]}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
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
              {mode === "signin" && <button type="button" className="text-button entry-forgot syr-forgot" onClick={() => { setError(null); setRecoveryResetOpen(true); }}>Forgot password? <span>Happens to the best of us.</span></button>}
            </div>
            {mode === "new-password" && <PasswordInput size="md" label="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} minLength={8} autoComplete="new-password" required disabled={submitting} visible={showPassword} onVisibilityChange={setShowPassword} classNames={{ innerInput: "entry-password-input", visibilityToggle: "auth-password-toggle" }} visibilityToggleIcon={({ reveal }) => reveal ? <EyeSlash size={19} /> : <Eye size={19} />} />}
            <FormError message={error} />
            {message && <div className="form-success"><CheckCircle size={18} weight="fill" />{message}</div>}
            <button className="primary-button entry-submit syr-submit" disabled={submitting}>{submitting ? text.busy : text.submit}</button>
            {mode === "signup" && <p className="entry-recovery-note"><ShieldCheck size={18} aria-hidden="true" />Next, you’ll set up a way to recover your account.</p>}
            {mode === "new-password" && <button type="button" className="text-button entry-back" onClick={() => switchMode("signin")}>Back to sign in</button>}
          </form>

          <p className="entry-footnote syr-footnote"><ShieldCheck size={16} aria-hidden="true" />Your ledger is yours alone. Not even your in-laws can peek.</p>
        </div>
      </section>

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
            setError(friendlyError(caught instanceof Error ? caught.message : "Could not create your account.", "signup"));
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
