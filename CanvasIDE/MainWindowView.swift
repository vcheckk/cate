import SwiftUI

/// Main window: Sidebar | Canvas
struct MainWindowView: View {
    @State private var sidebarWidth: CGFloat = 200
    @State private var isSidebarVisible: Bool = true

    var body: some View {
        HStack(spacing: 0) {
            if isSidebarVisible {
                SidebarView()
                    .frame(width: sidebarWidth)

                Divider()
            }

            // Canvas area — placeholder until Phase 2
            ZStack {
                Color(nsColor: NSColor(red: 0.11, green: 0.11, blue: 0.13, alpha: 1.0))

                Text("Canvas IDE")
                    .font(.largeTitle)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}
