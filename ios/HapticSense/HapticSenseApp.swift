import SwiftUI

@main
struct HapticSenseApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var socketManager = HapticSocketManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(socketManager)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                socketManager.disconnect()
            case .active:
                if let url = socketManager.lastURL, !socketManager.isConnected {
                    socketManager.connect(to: url)
                }
            default:
                break
            }
        }
    }
}
