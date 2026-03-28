import SwiftUI

// MARK: - Motion-Aware Animation Modifier

/// Applies a full animation when motion is allowed and a simpler cross-fade
/// when the user has enabled Reduce Motion in System Settings.
struct MotionAwareAnimationModifier<V: Equatable>: ViewModifier {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  let value: V
  let fullAnimation: Animation
  let reducedAnimation: Animation

  func body(content: Content) -> some View {
    content.animation(
      reduceMotion ? reducedAnimation : fullAnimation,
      value: value
    )
  }
}

extension View {
  /// Animates changes when motion is allowed, falling back to a subtle fade
  /// when Reduce Motion is enabled.
  func motionAwareAnimation<V: Equatable>(
    _ full: Animation,
    reduced: Animation = .easeInOut(duration: 0.15),
    value: V
  ) -> some View {
    modifier(
      MotionAwareAnimationModifier(
        value: value,
        fullAnimation: full,
        reducedAnimation: reduced
      ))
  }
}

// MARK: - Motion-Aware Transition

extension AnyTransition {
  /// Returns the full transition when motion is allowed, or a plain opacity
  /// fade when Reduce Motion is on. Because transitions are static, the
  /// caller must pass the current reduce-motion environment value.
  static func motionAware(
    _ full: AnyTransition,
    reduceMotion: Bool
  ) -> AnyTransition {
    reduceMotion ? .opacity : full
  }
}

// MARK: - Motion-Aware withAnimation

/// Wraps `withAnimation` to respect the Reduce Motion preference.
/// Call from within a View body or any context where the caller has already
/// read the environment value.
func withMotionAwareAnimation(
  reduceMotion: Bool,
  full: Animation = .spring(duration: 0.3),
  reduced: Animation = .easeInOut(duration: 0.15),
  _ body: () -> Void
) {
  withAnimation(reduceMotion ? reduced : full, body)
}
