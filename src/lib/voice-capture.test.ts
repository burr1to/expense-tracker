import { describe, expect, it, vi } from "vitest";
import { createVoiceCapture, type SpeechRecognitionLike } from "./voice-capture";
import { parseVoiceTransaction } from "./transaction-intelligence";
import { CATEGORIES } from "./categories";

function setup() {
  const instances: FakeRecognition[] = [];
  class FakeRecognition implements SpeechRecognitionLike {
    lang = "";
    continuous = true;
    interimResults = true;
    onresult: SpeechRecognitionLike["onresult"] = null;
    onerror: SpeechRecognitionLike["onerror"] = null;
    onend: SpeechRecognitionLike["onend"] = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() { instances.push(this); }
  }
  const callbacks = { onTranscript: vi.fn(), onStatus: vi.fn(), onListening: vi.fn() };
  const capture = createVoiceCapture(callbacks);
  const environment = { isSecureContext: true, SpeechRecognition: FakeRecognition };
  return { capture, callbacks, environment, instances, FakeRecognition };
}

describe("voice capture", () => {
  it("captures a reviewable transaction through the prefixed browser API", () => {
    const { capture, callbacks, FakeRecognition, instances } = setup();
    capture.toggle({ isSecureContext: true, webkitSpeechRecognition: FakeRecognition });
    const recognition = instances[0];
    expect(recognition.start).toHaveBeenCalledOnce();
    expect(recognition).toMatchObject({ lang: "en-US", continuous: false, interimResults: false });
    recognition.onresult?.({ results: [{ 0: { transcript: "Spent 450 on food at Thamel via cash today" }, isFinal: true }] });
    const transcript = callbacks.onTranscript.mock.calls[0][0];
    expect(parseVoiceTransaction(transcript, CATEGORIES, [])).toMatchObject({ amount: "450", category: "food", area: "Thamel", paymentMode: "cash" });
    recognition.onend?.();
    expect(callbacks.onListening).toHaveBeenLastCalledWith(false);
    expect(callbacks.onStatus).not.toHaveBeenLastCalledWith(expect.stringContaining("No speech"));
  });

  it("stops on a second tap and still accepts the final result", () => {
    const { capture, callbacks, environment, instances } = setup();
    capture.toggle(environment);
    capture.toggle(environment);
    expect(instances).toHaveLength(1);
    expect(instances[0].stop).toHaveBeenCalledOnce();
    instances[0].onresult?.({ results: [{ 0: { transcript: "Food 450" }, isFinal: true }] });
    instances[0].onend?.();
    expect(callbacks.onTranscript).toHaveBeenCalledWith("Food 450");
    capture.toggle(environment);
    expect(instances).toHaveLength(2);
  });

  it("explains an empty session instead of leaving the listening message", () => {
    const { capture, callbacks, environment, instances } = setup();
    capture.toggle(environment);
    instances[0].onresult?.({ results: [] });
    instances[0].onend?.();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("No speech was captured"));
    expect(callbacks.onListening).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ["not-allowed", "Microphone access is blocked"],
    ["service-not-allowed", "speech service is unavailable or blocked"],
    ["audio-capture", "No microphone is available"],
    ["network", "Check your connection"],
    ["language-not-supported", "does not support English"],
    ["no-speech", "No speech was detected"],
  ])("recovers from %s even when the browser never sends end", (error, message) => {
    const { capture, callbacks, environment, instances } = setup();
    capture.toggle(environment);
    instances[0].onerror?.({ error });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining(message));
    expect(callbacks.onListening).toHaveBeenLastCalledWith(false);
    expect(instances[0].abort).toHaveBeenCalledOnce();
    capture.toggle(environment);
    expect(instances).toHaveLength(2);
    expect(instances[1].start).toHaveBeenCalledOnce();
  });

  it("catches synchronous startup failures and allows retry", () => {
    const { capture, callbacks, environment, instances, FakeRecognition } = setup();
    class ThrowingRecognition extends FakeRecognition {
      start = vi.fn(() => { throw new DOMException("Blocked", "NotAllowedError"); });
    }
    expect(() => capture.toggle({ ...environment, SpeechRecognition: ThrowingRecognition })).not.toThrow();
    expect(callbacks.onListening).toHaveBeenLastCalledWith(false);
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("Microphone access is blocked"));
    capture.toggle(environment);
    expect(instances[1].start).toHaveBeenCalledOnce();
  });

  it("handles a constructor failure", () => {
    const { capture, callbacks } = setup();
    const Constructor = vi.fn(function () { throw new Error("Unavailable"); });
    expect(() => capture.toggle({ isSecureContext: true, SpeechRecognition: Constructor })).not.toThrow();
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("could not start or finish"));
  });

  it("cancels on close and ignores late results and end events after reopening", () => {
    const { capture, callbacks, environment, instances } = setup();
    capture.toggle(environment);
    const lateResult = instances[0].onresult;
    const lateEnd = instances[0].onend;
    capture.cancel();
    expect(instances[0].abort).toHaveBeenCalledOnce();
    capture.toggle(environment);
    lateResult?.({ results: [{ 0: { transcript: "Old draft 500" } }] });
    lateEnd?.();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onListening).toHaveBeenLastCalledWith(true);
    capture.toggle(environment);
    expect(instances[1].stop).toHaveBeenCalledOnce();
  });

  it("explains unsupported browsers and insecure origins without starting a session", () => {
    const { capture, callbacks, environment, instances } = setup();
    capture.toggle({ isSecureContext: true });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("not supported in this browser"));
    capture.toggle({ ...environment, isSecureContext: false });
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("HTTPS"));
    expect(instances).toHaveLength(0);
  });
});
