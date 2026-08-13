# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# This is the LITE app

The full Student Transportation Platform is the sibling directory
`../bus-tracking-app`. It is **read-only** from here: open it to read and port
from, never to edit.

This app answers one question — *where is the bus, and when does it reach my
stop* — and never claims to know where a **child** is. No driver role, no
boarding record, no rider statuses, no trips. If a change would let this app
assert a child's whereabouts, it does not belong here.

The spec is `.claude/skills/barebone/SKILL.md` (a symlink into the full repo).

# Two things that bite

**The dev server runs on port 8082**, not Expo's default 8081, because the Focus
app in a neighbouring directory uses 8081 and a favicon cache is per-origin. Use
`npm start`, which pins it.

**`Alert.alert` does nothing on web.** `react-native-web` ships it as
`static alert() {}`. Use `confirmAction()` / `notify()` from
`src/components/ui.tsx` — an admin at a desk is on the web build.
