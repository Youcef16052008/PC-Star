# PC Star — AR/FR/EN, theme, accounts

Demo-local shop session (Approach A). No real Google/SMS APIs.

- Languages: Arabic first (`dir=rtl`), then FR/EN. Product names stay catalog text.
- Theme: follow `prefers-color-scheme` until the visitor picks light or dark. Logged-in customers also pick accent (green, blue, red, gold) and an avatar.
- Auth (browser `localStorage`): email+password, phone + on-screen 6-digit code, Google demo button.
- Master: `pcstar.info31@gmail.com` / `star31`. Desk: toggle/add paneaux, add/hide products, delete customers, see pickup list. Cannot be deleted.
- Customers edit only their own profile.
