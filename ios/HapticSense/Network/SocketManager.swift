import Foundation
import SocketIO

final class HapticSocketManager: ObservableObject {

    // MARK: - Published State

    @Published private(set) var isConnected = false
    @Published private(set) var lastEvent: HapticEvent?

    /// Last URL we connected to — used for foreground reconnection.
    private(set) var lastURL: URL?

    // MARK: - Private

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    // MARK: - Connection

    func connect(to url: URL) {
        disconnect()
        lastURL = url

        let manager = SocketManager(
            socketURL: url,
            config: [
                .forceWebsockets(true),
                .reconnects(true),
                .reconnectWait(1),
                .log(false)
            ]
        )
        self.manager = manager
        let socket = manager.defaultSocket
        self.socket = socket

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            DispatchQueue.main.async { self?.isConnected = true }
            socket.emit("register-phone", ["role": "phone"])
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            DispatchQueue.main.async { self?.isConnected = false }
        }

        socket.on("haptic") { [weak self] data, _ in
            guard let dict = data.first,
                  let jsonData = try? JSONSerialization.data(withJSONObject: dict),
                  let event = try? JSONDecoder().decode(HapticEvent.self, from: jsonData)
            else { return }

            DispatchQueue.main.async {
                self?.lastEvent = event
            }
            HapticEngine.shared.playEvent(event)
        }

        socket.connect()
    }

    func disconnect() {
        socket?.disconnect()
        socket = nil
        manager?.disconnect()
        manager = nil
        DispatchQueue.main.async { self.isConnected = false }
    }
}
