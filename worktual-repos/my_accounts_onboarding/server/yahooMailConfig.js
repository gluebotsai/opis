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

/** Yahoo Mail API scopes (openid + mail). */
export const YAHOO_MAIL_SCOPES = ["openid", "email", "profile", "mail-r", "mail-w"];

export function getYahooClientId() {
  return env("YAHOO_CLIENT_ID");
}

export function getYahooClientSecret() {
  return env("YAHOO_CLIENT_SECRET");
}

export function getYahooRedirectUri() {
  return env("YAHOO_REDIRECT_URI") || "http://localhost:3002/auth/yahoo/callback";
}

export function isYahooMailConfigured() {
  return Boolean(getYahooClientId() && getYahooClientSecret());
}

export function getYahooAuthorizeEndpoint() {
  return "https://api.login.yahoo.com/oauth2/request_auth";
}

export function getYahooTokenEndpoint() {
  return "https://api.login.yahoo.com/oauth2/get_token";
}

export function getYahooUserInfoEndpoint() {
  return "https://api.login.yahoo.com/openid/v1/userinfo";
}
