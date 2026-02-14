# Accessibility for UI Automation

UI automation tools (XCUITest, AXorcist, Accessibility Inspector) rely on the accessibility tree to find and interact with elements. If your app doesn't annotate its views, automation will be unreliable or impossible — elements will be invisible, untappable, or have empty labels.

This applies to both iOS (simulator, XCUITest harness) and macOS (AXorcist / Accessibility API).

## The problem

SwiftUI and UIKit expose an accessibility tree to assistive technologies. UI automation tools read the same tree. When views lack accessibility annotations:

- `describe_ui` returns elements with empty `title`, `identifier`, and `description` fields.
- `tap` and `type` can't find the target element by name or identifier.
- On macOS, `AXPress` may not be available as an action on unannotated buttons.
- Coordinate-based fallbacks are fragile and break on layout changes.

## What to annotate

Every element that automation needs to find or interact with must have at least an `accessibilityIdentifier`. Labels and hints improve discoverability but identifiers are the reliable lookup key.

### SwiftUI

```swift
Button("New Chat") { createChat() }
    .accessibilityIdentifier("new-chat-button")
    .accessibilityLabel("New Chat")

TextField("Search", text: $query)
    .accessibilityIdentifier("search-field")

Toggle("Dark Mode", isOn: $darkMode)
    .accessibilityIdentifier("dark-mode-toggle")

// Tab bar items
TabView {
    ChatView()
        .tabItem { Label("Chat", systemImage: "bubble.left") }
        .accessibilityIdentifier("chat-tab")

    SettingsView()
        .tabItem { Label("Settings", systemImage: "gear") }
        .accessibilityIdentifier("settings-tab")
}

// Navigation links
NavigationLink("Profile", destination: ProfileView())
    .accessibilityIdentifier("profile-link")

// Lists — annotate each row
ForEach(sessions) { session in
    SessionRow(session: session)
        .accessibilityIdentifier("session-row-\(session.id)")
}
```

### UIKit

```swift
button.accessibilityIdentifier = "new-chat-button"
button.accessibilityLabel = "New Chat"

textField.accessibilityIdentifier = "search-field"

// Table view cells
cell.accessibilityIdentifier = "session-row-\(indexPath.row)"
```

## Naming conventions

- Use stable, descriptive, kebab-case identifiers: `"save-button"`, `"chat-input"`, `"session-list"`.
- Do not use display text as identifiers. Display text changes with localization; identifiers should not.
- Do not use SF Symbol names (`"gear"`, `"bubble.left"`) as identifiers. SwiftUI sometimes exposes them but they are fragile.
- For dynamic lists, include a stable ID suffix: `"session-row-\(session.id)"`.

## What happens without annotations

| Missing annotation | iOS (XCUITest) | macOS (AXorcist) |
|---|---|---|
| No `accessibilityIdentifier` | Element findable by label/type but fragile | Element only findable via `computedNameContains` or `textual_content` from `collectAll` |
| No `accessibilityLabel` | Button shows system-inferred text (often empty) | `AXTitle` is nil; title only available in `brief_description` or `textual_content` |
| No accessibility traits | Element type may be ambiguous | `AXRole` still works (SwiftUI infers it) but `AXActions` may be empty — `AXPress` unavailable on buttons |

Note: even with proper annotations, SwiftUI `TextField` on macOS does not expose `AXSetValue` via the Accessibility API. The axorcist backend handles this automatically by falling back to System Events keystroke simulation (tap to focus, then `osascript` keystroke).

The last point is critical on macOS: SwiftUI buttons without explicit accessibility configuration often report an empty `AXActions` list. This means the Accessibility API cannot programmatically press them — the `AXPress` action is not available. Adding `.accessibilityAddTraits(.isButton)` or ensuring the button has a proper `accessibilityLabel` typically fixes this.

## Verification workflow

After adding annotations:

1. Rebuild the app (`xcode_build` with `install: true`, `launch: true` for simulator, or rebuild and relaunch for macOS).
2. Run `describe_ui` and confirm your identifiers appear in the output.
3. If an element still shows `"identifier": ""`, the annotation is missing or on the wrong view layer.
4. For macOS, if `tap` fails with "action not supported" and "Available actions: []", the button needs accessibility traits or labels.

## Debugging tools

- **Accessibility Inspector** (Xcode > Open Developer Tool > Accessibility Inspector): inspect any running app's accessibility tree. Shows attributes, actions, and hierarchy.
- **`describe_ui`**: the automation-side view. If an element is missing here, it won't be automatable.
- On macOS, `axorc` with `collectAll` shows `textual_content` and `brief_description` even when attributes are opaque — useful for understanding what the element exposes.

## Minimum annotations for automation readiness

For a view to be fully automatable:

1. Every interactive element (button, text field, toggle, picker, link) has an `accessibilityIdentifier`.
2. Buttons have an `accessibilityLabel` (or SwiftUI `Label` content that infers one).
3. Scrollable lists annotate rows with unique identifiers.
4. Navigation elements (tabs, nav links, sidebar items) have identifiers.
5. Static text that automation needs to read or assert on has an identifier or is inside an annotated container.

Without these, automation is limited to fragile heuristics (text matching, tree position, coordinate taps) that break on any layout or copy change.
