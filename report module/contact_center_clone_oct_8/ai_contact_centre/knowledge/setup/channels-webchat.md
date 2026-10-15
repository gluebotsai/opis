# Setup — web chat channels

## Purpose

Create and personalise **Web Chat widgets** for Contact Centre. Generates a stable `webchatId` for later Installation / embed scripts. Lola and CCaaS spokes should read this config rather than inventing widget settings.

## Auth

Customer Bearer + org admin. **Requires** active `contact-center` subscription.

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js) |
| UI | [`SetupWebchatConfigPage.jsx`](../../src/pages/customer/setup/SetupWebchatConfigPage.jsx), [`WebchatPersonalisationPanel.jsx`](../../src/pages/customer/setup/WebchatPersonalisationPanel.jsx), [`WebchatPrimaryFormPanel.jsx`](../../src/pages/customer/setup/WebchatPrimaryFormPanel.jsx) |
| Defaults | [`webchatPersonalisation.js`](../../src/pages/customer/setup/webchatPersonalisation.js) (`DEFAULT_PERSONALISATION`, `DEFAULT_PRIMARY_FORM`) |
| Server | [`server/setupWebchat.js`](../../server/setupWebchat.js) |
| Repo | [`server/repositories/raw/setupWebchat.repo.js`](../../server/repositories/raw/setupWebchat.repo.js) |
| Uploads | `uploads/webchat/<orgId>/<configId>/` |

## Endpoints

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/channels?type=web_chat` | `listChannelConfigs("web_chat")` | `type=web_chat` | `{ channels }` | List widgets |
| GET | `/api/v1/me/setup/channels/web-chat/:id` | `getWebchatChannelConfig` | — | client returns `config` | Full widget |
| POST | `/api/v1/me/setup/channels/web-chat` | `createWebchatChannelConfig` | basic settings | `{ config }` → returns config | Allocates `webchatId` |
| PATCH | `/api/v1/me/setup/channels/web-chat/:id` | `updateWebchatChannelConfig` | basic + `personalisation` | `{ config }` | |
| DELETE | `/api/v1/me/setup/channels/web-chat/:id` | `deleteWebchatChannelConfig` | — | `204` | Deletes files under uploads |
| POST | `/api/v1/me/setup/channels/web-chat/:id/assets` | `uploadWebchatAsset` | multipart `file` + `kind` | `{ config, asset }` | ≤5MB JPEG/PNG |
| GET | `/api/v1/me/setup/channels/web-chat/:id/assets/:assetKey` | (fetch with Bearer) | — | image bytes | Auth required for `<img>` — use authenticated fetch → blob URL |

### Asset `kind` values

| kind | Updates personalisation fields |
|------|--------------------------------|
| `chat_icon_logo` | `chatIconLogoUrl` / `chatIconLogoKey` |
| `widget_icon_logo` | `widgetIconLogoUrl` / `widgetIconLogoKey` |
| `bot_avatar` | `botAvatarUrl` / `botAvatarKey`, preset `custom` |

## Key body fields

### Basic settings (create / patch)

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Channel display name |
| `aliasTitle` | yes | Subtitle |
| `greetingMessage` | yes | HTML (sanitized) |
| `description` | no | |
| `triggerMessage` | no | Max 100 chars; synced with personalisation Trigger UI |

### Personalisation (patch `personalisation` object)

Stored as JSONB on `setup_webchat_configs.personalisation`. Includes branding colours (solid/gradient), fonts, avatars, position, tracker flags, automated response copy, advance options checkboxes, etc. Server merges with defaults via `mergePersonalisation`.

### Primary Form (`personalisation.primaryForm`)

Nested under personalisation (no separate table). Wizard tab **Primary Form**. Preview priority: consent → pre-chat → chat.

| Field | Type | Notes |
|-------|------|-------|
| `consentEnabled` | boolean | Privacy consent gate before chat |
| `consentLanguage` | `"widget"` \| `"browser"` | Default `browser` |
| `consentMessage` | string | Required when consent enabled |
| `privacyPolicyUrl` | string | Required URL when consent enabled |
| `privacyPolicyLinkText` | string | Link label |
| `optInButton` / `optOutButton` | string | Button labels |
| `optOutConfirmation` | string | Shown after decline |
| `prechatEnabled` | boolean | Lead capture form |
| `prechatTitle` / `prechatMessage` | string | Form header copy |
| `prechatButtonLabel` | string | CTA label |
| `prechatButtonBg` | hex | Primary button colour |
| `prechatTitleLayout` | `"block"` \| `"inline"` | Title layout in widget |
| `customFields` | `{ id, label, mandatory }[]` | Max 20; defaults First name, Phone, Email* |

PATCH merges `primaryForm` deeply with the existing config so branding updates do not wipe form settings.

## Dependencies / gates

- Contact Centre (`contact-center`) must be purchased and active.
- Chat icon logo required before advancing personalisation in UI.

## Reuse notes

- **Lola / CCaaS:** embed using `webchatId`; render greeting HTML + personalisation colours; if `primaryForm.consentEnabled` / `prechatEnabled`, show those screens before the conversation composer.
- Installation tab (embed script) is still a stub in UI — id is already persisted for that phase.
- Bot Configuration tab is still a stub; Primary Form Next advances there after save.
