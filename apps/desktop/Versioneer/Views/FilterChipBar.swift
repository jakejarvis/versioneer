import SwiftUI

struct FilterChipBar: View {
  @Environment(AppState.self) private var appState
  @Namespace private var chipNamespace

  var body: some View {
    @Bindable var appState = appState

    HStack(spacing: 0) {
      GlassEffectContainer(spacing: 6) {
        HStack(spacing: 6) {
          ForEach(AppState.FilterSection.allCases) { section in
            filterChip(for: section)
          }
        }
      }

      Spacer(minLength: 8)

      if appState.filterPresentation.showUpdateAll {
        Button {
          Task { await appState.installAll() }
        } label: {
          Label(
            "Update All (\(appState.filterPresentation.updateAllCount))",
            systemImage: "arrow.down.circle"
          )
          .font(.caption.weight(.semibold))
        }
        .buttonStyle(.glassProminent)
        .controlSize(.small)
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(.ultraThinMaterial)
    .overlay(alignment: .bottom) {
      Divider()
    }
    .animation(.spring(duration: 0.25), value: appState.filterPresentation.showUpdateAll)
  }

  private func filterChip(for section: AppState.FilterSection) -> some View {
    let isSelected = appState.selectedSection == section
    let chip = appState.filterPresentation.chips.first { $0.id == section.rawValue }
    let count = chip?.count ?? 0

    return Button {
      withAnimation(.spring(duration: 0.2)) {
        appState.selectedSection = section
      }
    } label: {
      HStack(spacing: 5) {
        Image(systemName: section.systemImage)
          .font(.caption2.weight(.semibold))
        Text(section.shortTitle)
          .font(.caption.weight(.semibold))
        Text("\(count)")
          .font(.caption2.monospacedDigit().weight(.medium))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
    }
    .buttonStyle(.plain)
    .focusEffectDisabled()
    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
    .glassEffect(
      isSelected ? .regular.interactive() : .regular,
      in: .capsule
    )
    .glassEffectID(section, in: chipNamespace)
  }
}
