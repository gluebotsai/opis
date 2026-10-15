import { fetchJson } from "./http.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function requestPasswordResetOtp(email) {
  return fetchJson("/api/auth/password-reset/request", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
}

export async function verifyPasswordResetOtp(email, otp) {
  return fetchJson("/api/auth/password-reset/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, otp }),
  });
}

export async function confirmPasswordReset({ email, resetToken, password }) {
  return fetchJson("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, resetToken, password }),
  });
}
