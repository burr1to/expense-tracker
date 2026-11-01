"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { useEffect } from "react";
import { BrandIcon } from "../components/BrandIcon";

/** Any page that throws lands here instead of a blank screen; the providers above it keep running. */
export default function RouteError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <div className="app-error-screen" role="alert">
    <div className="app-error-card">
      <div className="loader-brand"><BrandIcon size={42} /><span><strong>SaveYoRupee</strong><small>Your money, clearly.</small></span></div>
      <span className="app-error-icon" aria-hidden="true"><WarningCircle size={24} weight="duotone" /></span>
      <h1>Something went wrong</h1>
      <p>This screen ran into a problem it didn’t expect. Everything you saved is safe. Try again, or reload the app.</p>
      {error.digest && <small className="app-error-code">Reference {error.digest}</small>}
      <div className="app-error-actions">
        <button type="button" className="primary-button" onClick={() => unstable_retry()}><ArrowClockwise size={17} />Try again</button>
        <button type="button" className="secondary-button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  </div>;
}
