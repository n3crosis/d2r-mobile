; RUN: opt -enable-new-pm=0 '-MetalFinal module cleanup' -verify-each -S %s | FileCheck %s
;
; Keep the in-memory locality required by LLVM, including generated static
; initializers, while clearing only optional explicit dso_local for AIR.
; The verifier is essential: the IR printer omits *implicit* dso_local and the
; bitcode reader re-infers it, so a print/reparse-only test can hide this bug.
;
; This fixture is independently authored and contains no application shader.

target triple = "air64-apple-ios18.0.0"

@predicate = internal addrspace(2) global i8 0, align 1

; CHECK-LABEL: define internal float @internal_helper(
define internal float @internal_helper(float %value) noinline {
  %result = fadd float %value, 2.500000e-01
  ret float %result
}

; CHECK-LABEL: define private void @private_helper(
define private void @private_helper() {
  ret void
}

; CHECK-LABEL: define hidden void @hidden_helper(
define hidden void @hidden_helper() {
  ret void
}

; CHECK-LABEL: define protected void @protected_helper(
define protected void @protected_helper() {
  ret void
}

; CHECK-LABEL: declare hidden void @hidden_declaration(
declare hidden void @hidden_declaration()

; External-weak linkage is deliberately exempt from implicit locality.
; CHECK-LABEL: declare extern_weak hidden void @weak_hidden_declaration(
declare extern_weak hidden void @weak_hidden_declaration()

; CHECK-LABEL: declare void @default_declaration(
declare dso_local void @default_declaration()

; CHECK-LABEL: define internal void @__metal_fc_pred_init()
; CHECK-SAME: section "air.static_init"
define internal void @__metal_fc_pred_init() section "air.static_init" {
  store i8 1, i8 addrspace(2)* @predicate, align 1
  ret void
}

; The existing clearing behavior remains in place for default-visibility
; externally linked functions, including entry points.
; CHECK-LABEL: define void @main0(
define dso_local void @main0() {
  call void @__metal_fc_pred_init()
  ret void
}
