import SwiftUI

/// Sidebar with workspace/project list
struct SidebarView: View {
    var body: some View {
        VStack(spacing: 0) {
            // Titlebar spacing
            Spacer().frame(height: 28)

            // Workspace list placeholder
            ScrollView {
                VStack(spacing: 4) {
                    Text("Workspaces")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                }
            }

            Spacer()
        }
        .frame(maxHeight: .infinity)
    }
}
