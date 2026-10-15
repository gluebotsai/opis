function env(name) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

export const GOOGLE_MAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export function getGoogleClientId() {
  return env("GOOGLE_CLIENT_ID");
}

export function getGoogleClientSecret() {
  return env("GOOGLE_CLIENT_SECRET");
}

export function getGoogleRedirectUri() {
  return (
    env("GOOGLE_REDIRECT_URI") || "http://localhost:3002/auth/google/callback"
  );
}

export function isGoogleMailConfigured() {
  return Boolean(getGoogleClientId() && getGoogleClientSecret());
}

export function getGoogleAuthorizeEndpoint() {
  return "https://accounts.google.com/o/oauth2/v2/auth";
}

export function getGoogleTokenEndpoint() {
  return "https://oauth2.googleapis.com/token";
}

export function getGoogleUserInfoEndpoint() {
  return "https://www.googleapis.com/oauth2/v2/userinfo";
}
