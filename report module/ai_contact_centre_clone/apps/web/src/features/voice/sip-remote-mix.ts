export function shouldPlayCustomerConferenceTrack(input: {
  merged: boolean;
  muted: boolean;
  ended: boolean;
}): boolean {
  return input.merged && !input.muted && !input.ended;
}

export function shouldKeepConsultPlayback(input: {
  leg: "customer" | "consult";
  merged: boolean;
  consultActive: boolean;
}): boolean {
  return input.leg === "customer" && input.consultActive && !input.merged;
}
