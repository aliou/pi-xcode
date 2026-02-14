import SwiftUI

struct HomeTab: View {
    @State private var inputText: String = ""
    @State private var items: [String] = ["Alpha", "Bravo", "Charlie"]
    @State private var showAlert: Bool = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                TextField("Type something", text: $inputText)
                    .accessibilityIdentifier("home-text-field")

                Button("Add Item") {
                    items.append(inputText)
                    inputText = ""
                }
                .accessibilityIdentifier("add-item-button")

                Button("Show Alert") {
                    showAlert = true
                }
                .accessibilityIdentifier("show-alert-button")

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
            .alert("Test Alert", isPresented: $showAlert) {
                Button("OK") {
                    showAlert = false
                }
                .accessibilityIdentifier("alert-ok-button")
            }
        }
    }
}
