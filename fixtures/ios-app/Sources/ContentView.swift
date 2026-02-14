import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            HomeTab()
                .tabItem {
                    Label("Home", systemImage: "house")
                }
                .accessibilityIdentifier("home-tab")

            SettingsTab()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .accessibilityIdentifier("settings-tab")
        }
        .accessibilityIdentifier("main-tab-view")
    }
}
