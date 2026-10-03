import { BellSimple, CheckCircle, Eye, EyeSlash, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { PasswordInput, TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { BrandIcon } from "../components/BrandIcon";
import { LedgerIcon } from "../components/LedgerIcon";
import { RecoveryResetModal } from "../components/RecoveryResetModal";
import { RecoverySetupModal } from "../components/RecoverySetupModal";
import { SlidingTabs } from "../components/SlidingTabs";
import { useAuth } from "../context/AuthContext";
import { FormError } from "../components/FormError";
import { formatMoney } from "../lib/currency";
import { formatLedgerMonth } from "../lib/dates";
import type { CategoryIconName } from "../types";

type AuthMode = "signin" | "signup" | "new-password";

const modeTabs = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
] as const;

const copy: Record<AuthMode, { title: string; lede: string; submit: string; busy: string }> = {
  signin: { title: "Welcome back", lede: "Sign in to pick up where you left off.", submit: "Sign in", busy: "Signing in…" },
  signup: { title: "Start your ledger", lede: "Takes a minute. Your first entry can wait.", submit: "Continue", busy: "Please wait…" },
  "new-password": { title: "Choose a new password", lede: "Use at least eight characters.", submit: "Update password", busy: "Updating…" },
};

interface PreviewEntry { label: string; note: string; icon: CategoryIconName; amount: number }
interface FeedRow { id: number; entry: PreviewEntry; state: "initial" | "fresh" | "settled" | "leaving" }

const VISIBLE_ROWS = 4;
const ARRIVAL_EVERY_MS = 3200;

const startingEntries: PreviewEntry[] = [
  { label: "Groceries", note: "Bhatbhateni", icon: "food", amount: -324000 },
  { label: "Ride home", note: "Pathao", icon: "transport", amount: -31000 },
  { label: "Salary", note: "Monthly pay", icon: "money", amount: 8500000 },
  { label: "Rent", note: "Baneshwor flat", icon: "home", amount: -2200000 },
];

// Roughly balances out over one loop, so the running totals never drift far.
const arrivingEntries: PreviewEntry[] = [
  { label: "Momo", note: "Jhamsikhel", icon: "food", amount: -68000 },
  { label: "Mobile top-up", note: "Ncell", icon: "utilities", amount: -50000 },
  { label: "Freelance payment", note: "Logo design", icon: "work", amount: 800000 },
  { label: "Coffee", note: "Himalayan Java", icon: "food", amount: -35000 },
  { label: "Petrol", note: "Nepal Oil", icon: "transport", amount: -180000 },
  { label: "Books", note: "Bookworm", icon: "education", amount: -120000 },
  { label: "Gym", note: "Monthly fee", icon: "health", amount: -250000 },
  { label: "Dashain tika", note: "From Didi", icon: "gift", amount: 300000 },
  { label: "Groceries", note: "Big Mart", icon: "food", amount: -214000 },
  { label: "Bus fare", note: "Sajha Yatayat", icon: "transport", amount: -3000 },
  { label: "Electricity", note: "NEA", icon: "utilities", amount: -146000 },
];

/** Eases a displayed number toward its target, rounded to whole rupees. */
function useTweenedMoney(target: number, duration = 700) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      const value = progress === 1 ? target : Math.round((from + (target - from) * eased) / 100) * 100;
      shownRef.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}

function MonthPreview() {
  const [month] = useState(() => formatLedgerMonth(new Date(), "BS"));
  const [feed, setFeed] = useState(() => ({
    rows: startingEntries.map((entry, index): FeedRow => ({ id: index, entry, state: "initial" })),
    nextId: startingEntries.length,
    cursor: 0,
    moneyIn: 8500000,
    moneyOut: 2701000,
  }));
  const moneyIn = useTweenedMoney(feed.moneyIn);
  const moneyOut = useTweenedMoney(feed.moneyOut);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setFeed((current) => {
        const entry = arrivingEntries[current.cursor % arrivingEntries.length];
        const kept = current.rows.filter((row) => row.state !== "leaving");
        const rows = [{ id: current.nextId, entry, state: "fresh" } as FeedRow, ...kept.map((row): FeedRow => ({ ...row, state: "settled" }))]
          .map((row, index): FeedRow => (index >= VISIBLE_ROWS ? { ...row, state: "leaving" } : row));
        return {
          rows,
          nextId: current.nextId + 1,
          cursor: current.cursor + 1,
          moneyIn: current.moneyIn + Math.max(entry.amount, 0),
          moneyOut: current.moneyOut + Math.max(-entry.amount, 0),
        };
      });
    }, ARRIVAL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="entry-preview" aria-hidden="true">
      <div className="entry-preview-head">
        <span className="entry-preview-month">{month}</span>
        <span className="entry-preview-net">{formatMoney(moneyIn - moneyOut, "NPR")}<small>left this month</small></span>
      </div>
      <div className="entry-preview-split">
        <span style={{ flexGrow: moneyOut }} />
        <span style={{ flexGrow: moneyIn - moneyOut }} />
      </div>
      <div className="entry-preview-totals">
        <span>Spent {formatMoney(moneyOut, "NPR")}</span>
        <span>of {formatMoney(moneyIn, "NPR")} in</span>
      </div>
      <div className="entry-preview-day">
        <span className="entry-preview-day-label">Today</span>
        {feed.rows.map((row, index) => (
          <div className={`entry-feed-item is-${row.state}${row.entry.amount > 0 ? " is-income" : ""}`} key={row.id} style={{ "--row": index } as React.CSSProperties}>
            <div className="entry-feed-clip">
              <div className="entry-preview-row">
                <span className="entry-preview-icon"><LedgerIcon icon={row.entry.icon} size={18} /></span>
                <span className="entry-preview-text"><strong>{row.entry.label}</strong><span>{row.entry.note}</span></span>
                <span className={row.entry.amount > 0 ? "entry-preview-amount is-in" : "entry-preview-amount"}>
                  {row.entry.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(row.entry.amount), "NPR")}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="entry-preview-due" style={{ "--row": VISIBLE_ROWS } as React.CSSProperties}>
        <BellSimple size={17} weight="bold" />
        <span>Internet bill due in 3 days</span>
        <strong>{formatMoney(150000, "NPR")}</strong>
      </div>
    </div>
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
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: AuthMode) => { setMode(next); setError(null); setMessage(null); setConfirmPassword(""); };

  return (
    <main className="entry-screen">
      <section className="entry-panel" aria-labelledby="entry-title">
        <div className="brand-mark entry-brand"><BrandIcon size={30} /><span>SaveYoRupee</span></div>

        <div className="entry-form-wrap">
          {mode !== "new-password" && (
            <SlidingTabs label="Sign in or create an account" value={mode} onChange={switchMode} options={modeTabs} className="entry-tabs" disabled={submitting} />
          )}

          <div ref={copyRef} className="t-stagger entry-copy">
            <h1 id="entry-title" className="t-stagger-line t-stagger-line--1">{text.title}</h1>
            <p className="t-stagger-line t-stagger-line--2">{text.lede}</p>
          </div>

          <form onSubmit={submit} className="entry-form">
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
              {mode === "signin" && <button type="button" className="text-button entry-forgot" onClick={() => { setError(null); setRecoveryResetOpen(true); }}>Forgot password?</button>}
            </div>
            {mode === "new-password" && <PasswordInput size="md" label="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} minLength={8} autoComplete="new-password" required disabled={submitting} visible={showPassword} onVisibilityChange={setShowPassword} classNames={{ innerInput: "entry-password-input", visibilityToggle: "auth-password-toggle" }} visibilityToggleIcon={({ reveal }) => reveal ? <EyeSlash size={19} /> : <Eye size={19} />} />}
            <FormError message={error} />
            {message && <div className="form-success"><CheckCircle size={18} weight="fill" />{message}</div>}
            <button className="primary-button entry-submit" disabled={submitting}>{submitting ? text.busy : text.submit}</button>
            {mode === "signup" && <p className="entry-recovery-note"><ShieldCheck size={18} aria-hidden="true" />Next, you’ll set up a way to recover your account.</p>}
            {mode === "new-password" && <button type="button" className="text-button entry-back" onClick={() => switchMode("signin")}>Back to sign in</button>}
          </form>
        </div>

        <p className="entry-footnote"><LockKey size={16} aria-hidden="true" />Your ledger is private to your account.</p>
      </section>

      <aside className="entry-story" aria-label="What SaveYoRupee shows you">
        <div className="entry-story-inner">
          <h2>See the whole month.</h2>
          <p>Money in, money out, and what’s coming due, on one quiet page. In rupees, with Bikram Sambat dates.</p>
          <MonthPreview />
        </div>
      </aside>

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
