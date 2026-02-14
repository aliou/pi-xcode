import SwiftUI

struct ContentView: View {
    @State private var selectedLink: String? = "home"
    @State private var inputText: String = ""
    @State private var items: [String] = ["Alpha", "Bravo", "Charlie"]
    @State private var notificationsEnabled: Bool = true
    @State private var darkModeEnabled: Bool = false

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedLink) {
                NavigationLink(value: "home") {
                    Label("Home", systemImage: "house")
                }
                .accessibilityIdentifier("sidebar-home")

                NavigationLink(value: "settings") {
                    Label("Settings", systemImage: "gear")
                }
                .accessibilityIdentifier("sidebar-settings")
            }
            .accessibilityIdentifier("sidebar-list")
        } detail: {
            switch selectedLink {
            case "settings":
                settingsView
            default:
                homeView
            }
        }
    }

    // MARK: - Home View

    private var homeView: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                TextField("Type something", text: $inputText)
                    .accessibilityIdentifier("home-text-field")

                Button("Add Item") {
                    items.append(inputText)
                    inputText = ""
                }
                .accessibilityIdentifier("add-item-button")
            }

            List {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    Text(item)
                        .accessibilityIdentifier("list-item-\(index)")
                }
            }
            .accessibilityIdentifier("items-list")
        }
        .padding()
        .navigationTitle("Home")
    }

    // MARK: - Settings View

    private var settingsView: some View {
        Form {
            Toggle("Notifications", isOn: $notificationsEnabled)
                .accessibilityIdentifier("notifications-toggle")

            Toggle("Dark Mode", isOn: $darkModeEnabled)
                .accessibilityIdentifier("dark-mode-toggle")

            Button("Save") {
                // no-op
            }
            .accessibilityIdentifier("save-button")

            Button("Reset") {
                notificationsEnabled = true
                darkModeEnabled = false
            }
            .accessibilityIdentifier("reset-button")
        }
        .padding()
        .navigationTitle("Settings")
    }
}
