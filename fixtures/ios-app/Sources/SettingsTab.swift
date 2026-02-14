import SwiftUI

struct SettingsTab: View {
    @State private var username: String = ""
    @State private var notificationsEnabled: Bool = true
    @State private var darkModeEnabled: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Username", text: $username)
                        .accessibilityIdentifier("username-field")
                }

                Section("Preferences") {
                    Toggle("Notifications", isOn: $notificationsEnabled)
                        .accessibilityIdentifier("notifications-toggle")

                    Toggle("Dark Mode", isOn: $darkModeEnabled)
                        .accessibilityIdentifier("dark-mode-toggle")
                }

                Section {
                    Button("Save") {
                        // no-op
                    }
                    .accessibilityIdentifier("save-button")

                    Button("Reset") {
                        username = ""
                        notificationsEnabled = true
                        darkModeEnabled = false
                    }
                    .accessibilityIdentifier("reset-button")
                }
            }
            .navigationTitle("Settings")
        }
    }
}
