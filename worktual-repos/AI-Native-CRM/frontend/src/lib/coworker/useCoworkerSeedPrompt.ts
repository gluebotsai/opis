import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  readCreateSeedPrompt,
  readCreateUserText,
  stripCreateSeedPrompt,
} from "@/lib/coworker/create-handoff";

/**
 * When landing on a create hybrid with ?prompt=, continue the draft chat
 * with that utterance once the page is ready.
 */
export function useCoworkerSeedPrompt(options: {
  ready: boolean;
  sendText: (
    text: string,
    opts?: { displayText?: string },
  ) => void | Promise<void>;
}) {
  const { ready, sendText } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const consumed = useRef(false);
  const sendRef = useRef(sendText);
  sendRef.current = sendText;

  useEffect(() => {
    if (!ready || consumed.current) return;
    const prompt = readCreateSeedPrompt(searchParams);
    if (!prompt) return;
    const said = readCreateUserText(searchParams);
    consumed.current = true;
    setSearchParams(stripCreateSeedPrompt(searchParams), { replace: true });
    void sendRef.current(
      prompt,
      said && said !== prompt ? { displayText: said } : undefined,
    );
  }, [ready, searchParams, setSearchParams]);
}
