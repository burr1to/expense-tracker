interface SpeechResult { 0?: { transcript?: string }; isFinal?: boolean }
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechEnvironment {
  isSecureContext: boolean;
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

function voiceError(code?: string) {
  switch (code) {
    case "not-allowed": return "Microphone access is blocked. Allow the microphone in this site's browser settings, then try again.";
    case "service-not-allowed": return "Your browser's speech service is unavailable or blocked. Try another browser with speech recognition, or enter the details manually.";
    case "audio-capture": return "No microphone is available. Connect or enable a microphone, then try again.";
    case "network": return "Could not reach your browser's speech service. Check your connection, or try another browser with speech recognition.";
    case "language-not-supported": return "Your browser's speech service does not support English. Enter the details manually or try another browser.";
    case "no-speech": return "No speech was detected. Try again and speak after tapping the microphone.";
    case "aborted": return "Voice capture stopped. Tap the microphone to try again.";
    default: return "Voice capture could not start or finish. Try again, or enter the details manually.";
  }
}

/** Own one browser session per sheet; callbacks from cancelled sessions cannot edit a new draft. */
export function createVoiceCapture(callbacks: {
  onTranscript: (transcript: string) => void;
  onStatus: (status: string) => void;
  onListening: (listening: boolean) => void;
}) {
  let active: SpeechRecognitionLike | null = null;

  const release = (recognition: SpeechRecognitionLike, abort = false) => {
    if (active !== recognition) return;
    active = null;
    recognition.onresult = recognition.onerror = recognition.onend = null;
    if (abort) {
      try { recognition.abort(); } catch { /* Some browsers throw after ending the session. */ }
    }
    callbacks.onListening(false);
  };

  return {
    cancel() { if (active) release(active, true); },
    toggle(environment: SpeechEnvironment) {
      if (active) {
        const recognition = active;
        try { recognition.stop(); } catch { release(recognition, true); callbacks.onStatus(voiceError()); }
        return;
      }
      if (!environment.isSecureContext) {
        callbacks.onStatus("Microphone access requires a secure connection. Open this app over HTTPS, or enter the details manually.");
        return;
      }
      const Constructor = environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
      if (!Constructor) {
        callbacks.onStatus("Voice capture is not supported in this browser. Use a browser with speech recognition, or enter the details manually.");
        return;
      }
      try {
        const recognition = new Constructor();
        active = recognition;
        // Use an English locale supported by speech services rather than assuming en-NP exists.
        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = false;
        let captured = false;
        recognition.onresult = (event) => {
          if (active !== recognition) return;
          const transcript = Array.from(event.results).filter((result) => result.isFinal !== false).map((result) => result[0]?.transcript ?? "").join(" ").trim();
          if (transcript) {
            captured = true;
            callbacks.onTranscript(transcript);
          }
        };
        recognition.onerror = (event) => {
          if (active !== recognition) return;
          release(recognition, true);
          callbacks.onStatus(voiceError(event.error));
        };
        recognition.onend = () => {
          if (active !== recognition) return;
          release(recognition);
          if (!captured) callbacks.onStatus("No speech was captured. Tap the microphone and try again.");
        };
        callbacks.onStatus("Listening… Say, for example, ‘Spent 450 on food at Thamel in cash today.’ Your browser may use its own speech service.");
        callbacks.onListening(true);
        recognition.start();
      } catch (error) {
        if (active) release(active, true);
        callbacks.onStatus(voiceError(error instanceof Error && error.name === "NotAllowedError" ? "not-allowed" : undefined));
      }
    },
  };
}
