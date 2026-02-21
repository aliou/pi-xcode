import XCTest

@MainActor
final class AutomationBridgeSmokeTests: XCTestCase {
    func testPrimitiveFlowForChainActions() {
        let app = XCUIApplication()
        if app.state == .notRunning || app.state == .unknown {
            app.launch()
        } else {
            app.activate()
        }

        let bridge = AutomationBridge(app: app)

        let steps: [AutomationPayload] = [
            AutomationPayload(
                action: "tap",
                params: ["identifier": .string("home-text-field")],
                metadata: nil
            ),
            AutomationPayload(
                action: "clear_text",
                params: ["identifier": .string("home-text-field")],
                metadata: nil
            ),
            AutomationPayload(
                action: "type",
                params: [
                    "identifier": .string("home-text-field"),
                    "text": .string("Delta")
                ],
                metadata: nil
            ),
            AutomationPayload(
                action: "tap",
                params: ["identifier": .string("add-item-button")],
                metadata: nil
            ),
            AutomationPayload(
                action: "query_text",
                params: [
                    "text": .string("Delta"),
                    "match": .string("exact")
                ],
                metadata: nil
            )
        ]

        var results: [AutomationResult] = []
        for step in steps {
            results.append(bridge.execute(payload: step))
        }

        for (index, result) in results.enumerated() {
            XCTAssertTrue(
                result.isOk,
                "Step \(index + 1) '\(result.action)' should succeed. Errors: \(String(describing: result.errors))"
            )
        }

        let queryResult = results.last
        let count = queryResult?.data?["count"]?.intValue ?? 0
        XCTAssertGreaterThanOrEqual(count, 1, "Expected to find at least one 'Delta' label")
    }
}
