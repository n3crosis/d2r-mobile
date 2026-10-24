; Authored public diagnostic regression. No private source or IR is included.
; RUN: split-file %s %t
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/select.ll 2>&1 | FileCheck %s --check-prefix=SELECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/phi.ll 2>&1 | FileCheck %s --check-prefix=PHI
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/bounded.ll 2>&1 | FileCheck %s --check-prefix=BOUND
; These exact line endings verify that no instruction or source names are
; appended by LLVMContext::emitError. The original rejection is unchanged.
; The select/PHI fixtures intentionally have an unknown native integer-pointer
; argument arm. They do not have a proven matching source-storage mapping and
; remain rejected; supported read-only merges are tested in
; metal-constant-vector-merges.ll.
; SELECT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unmapped argument or constant pointer root{{$}}
; PHI: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: phi; constant-vector graph: unmapped argument or constant pointer root{{$}}
; BOUND: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: getelementptr, getelementptr, getelementptr, getelementptr, ...{{$}}
; Authored for future CI execution. No LLVM compiler or verifier was run here.

;--- select.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment <4 x i32> @reject_select(%Buffer addrspace(2)* %buffer, <4 x i32> addrspace(2)* %other, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %other
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- phi.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment <4 x i32> @reject_phi(%Buffer addrspace(2)* %buffer, <4 x i32> addrspace(2)* %other, i1 %condition) {
entry:
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  br i1 %condition, label %left, label %right
left:
  br label %merge
right:
  br label %merge
merge:
  %chosen = phi <4 x i32> addrspace(2)* [ %raw, %left ], [ %other, %right ]
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- bounded.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
; AS1 is intentionally outside the narrow Metal AS2 lowering.
define floor_fragment void @reject_many_users(%Buffer addrspace(1)* %buffer) {
  %raw = bitcast %Buffer addrspace(1)* %buffer to <4 x i32> addrspace(1)*
  %a = getelementptr <4 x i32>, <4 x i32> addrspace(1)* %raw, i64 0
  %b = getelementptr <4 x i32>, <4 x i32> addrspace(1)* %raw, i64 1
  %c = getelementptr <4 x i32>, <4 x i32> addrspace(1)* %raw, i64 2
  %d = getelementptr <4 x i32>, <4 x i32> addrspace(1)* %raw, i64 3
  %e = getelementptr <4 x i32>, <4 x i32> addrspace(1)* %raw, i64 4
  ret void
}
