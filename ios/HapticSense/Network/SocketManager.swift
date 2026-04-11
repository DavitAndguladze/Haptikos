import Combine
import Foundation

/// Placeholder for `feat/ios-networking` — Socket.IO client will decode `HapticEvent` and call `HapticEngine.shared.playEvent`.
final class SocketManager: ObservableObject {
    static let shared = SocketManager()

    @Published var isConnected = false

    private init() {}
}
