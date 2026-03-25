import SwiftUI

struct EmptyStateView: View {
    var body: some View {
        ContentUnavailableView(
            "Select an App",
            systemImage: "sidebar.right",
            description: Text("Choose an app from the list to view its details.")
        )
    }
}
