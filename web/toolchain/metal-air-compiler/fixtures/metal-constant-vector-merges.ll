; Authored public pointer-SSA regression; no private shader IR is included.
; RUN: split-file %s %t
; RUN: opt -enable-new-pm=0 -PointerBCFixup -verify -S %t/merges.ll | FileCheck %s --check-prefix=MERGE
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/unknown.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/layout.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/escape.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/write.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/volatile.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/atomic.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/null.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/undef.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/poison.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; REJECT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions)
; This file is authored for CI. No compiler/verifier execution is claimed.

;--- merges.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

; MERGE-LABEL: define floor_fragment <4 x i32> @diamond(
; MERGE: left:
; MERGE-NEXT: %raw.storage = getelementptr %Buffer, %Buffer addrspace(2)* %first, i32 0, i32 0, i32 0
; MERGE-NEXT: %offset.typed = getelementptr inbounds <4 x float>, <4 x float> addrspace(2)* %raw.storage, i64 %row
; MERGE-NEXT: br label %merge
; MERGE: right:
; MERGE-NEXT: %native = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %second, i32 0, i32 0, i64 %other.row
; MERGE-NEXT: br label %merge
; MERGE: merge:
; MERGE-NEXT: %chosen.typed = phi <4 x float> addrspace(2)* [ %offset.typed, %left ], [ %native, %right ]
; MERGE-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %chosen.typed, align 4
; MERGE-NEXT: %value.bits = bitcast <4 x float> %value.typed to <4 x i32>
; MERGE-NEXT: ret <4 x i32> %value.bits
define floor_fragment <4 x i32> @diamond(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i64 %row, i64 %other.row, i1 %condition) {
entry:
  br i1 %condition, label %left, label %right
left:
  %raw = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %offset = getelementptr inbounds <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 %row
  br label %merge
right:
  %native = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %second, i32 0, i32 0, i64 %other.row
  %other = bitcast <4 x float> addrspace(2)* %native to <4 x i32> addrspace(2)*
  br label %merge
merge:
  %chosen = phi <4 x i32> addrspace(2)* [ %offset, %left ], [ %other, %right ]
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 4
  ret <4 x i32> %value
}

; An earlier non-struct root must not reach legacy rejection before the seed.
; MERGE-LABEL: define floor_fragment <4 x i32> @select_earlier_vector_root(
; MERGE-NEXT: %raw.storage = getelementptr %Buffer, %Buffer addrspace(2)* %buffer, i32 0, i32 0, i32 0
; MERGE-NEXT: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %native, <4 x float> addrspace(2)* %raw.storage, !prof
; MERGE-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %chosen.typed, align 16, !invariant.load
; MERGE-NEXT: %value.bits = bitcast <4 x float> %value.typed to <4 x i32>
; MERGE-NEXT: ret <4 x i32> %value.bits
define floor_fragment <4 x i32> @select_earlier_vector_root(%Buffer addrspace(2)* %buffer, <4 x float> addrspace(2)* %native, i1 %condition) {
  %early = bitcast <4 x float> addrspace(2)* %native to <4 x i32> addrspace(2)*
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %early, <4 x i32> addrspace(2)* %raw, !prof !0
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16, !invariant.load !1
  ret <4 x i32> %value
}

; MERGE-LABEL: define floor_fragment <4 x i32> @loop_carried(
; MERGE: loop:
; MERGE-NEXT: %cursor.typed = phi <4 x float> addrspace(2)* [ %raw.storage, %entry ], [ %next.typed, %loop ]
; MERGE-NEXT: %next.typed = getelementptr inbounds <4 x float>, <4 x float> addrspace(2)* %cursor.typed, i64 %stride
; MERGE-NEXT: br i1 %again, label %loop, label %exit
; MERGE: exit:
; MERGE-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %cursor.typed, align 1
; MERGE-NEXT: %value.bits = bitcast <4 x float> %value.typed to <4 x i32>
define floor_fragment <4 x i32> @loop_carried(%Buffer addrspace(2)* %buffer, i64 %stride, i1 %again) {
entry:
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  br label %loop
loop:
  %cursor = phi <4 x i32> addrspace(2)* [ %raw, %entry ], [ %next, %loop ]
  %next = getelementptr inbounds <4 x i32>, <4 x i32> addrspace(2)* %cursor, i64 %stride
  br i1 %again, label %loop, label %exit
exit:
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %cursor, align 1
  ret <4 x i32> %value
}

; Mutually recursive PHIs retain duplicate incoming edges exactly.
; MERGE-LABEL: define floor_fragment <4 x i32> @mutual_phis(
; MERGE: loop:
; MERGE-NEXT: %a.typed = phi <4 x float> addrspace(2)* [ %first.raw.storage, %entry ], [ %b.typed, %loop ], [ %b.typed, %loop ]
; MERGE-NEXT: %b.typed = phi <4 x float> addrspace(2)* [ %second.raw.storage, %entry ], [ %a.typed, %loop ], [ %a.typed, %loop ]
; MERGE-NEXT: switch i32 %choice, label %exit [
define floor_fragment <4 x i32> @mutual_phis(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i32 %choice) {
entry:
  %first.raw = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %second.raw = bitcast %Buffer addrspace(2)* %second to <4 x i32> addrspace(2)*
  br label %loop
loop:
  %a = phi <4 x i32> addrspace(2)* [ %first.raw, %entry ], [ %b, %loop ], [ %b, %loop ]
  %b = phi <4 x i32> addrspace(2)* [ %second.raw, %entry ], [ %a, %loop ], [ %a, %loop ]
  switch i32 %choice, label %exit [ i32 0, label %loop
                                  i32 1, label %loop ]
exit:
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %a, align 16
  ret <4 x i32> %value
}

; MERGE-LABEL: define floor_fragment i32 @scalar_merge(
; MERGE: %lane.typed = getelementptr <4 x float>, <4 x float> addrspace(2)* %raw.storage, i64 %row, i32 %lane.index
; MERGE: merge:
; MERGE-NEXT: %chosen.typed = phi float addrspace(2)* [ %lane.typed, %left ], [ %native, %right ]
; MERGE-NEXT: %value.typed = load float, float addrspace(2)* %chosen.typed, align 1
; MERGE-NOT: !range
; MERGE-NEXT: %value.bits = bitcast float %value.typed to i32
define floor_fragment i32 @scalar_merge(%Buffer addrspace(2)* %buffer, float addrspace(2)* %native, i64 %row, i32 %lane.index, i1 %condition) {
entry:
  %early = bitcast float addrspace(2)* %native to i32 addrspace(2)*
  br i1 %condition, label %left, label %right
left:
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 %row, i32 %lane.index
  br label %merge
right:
  br label %merge
merge:
  %chosen = phi i32 addrspace(2)* [ %lane, %left ], [ %early, %right ]
  %value = load i32, i32 addrspace(2)* %chosen, align 1, !range !2
  ret i32 %value
}
!0 = !{!"branch_weights", i32 7, i32 3}
!1 = !{}
!2 = !{i32 0, i32 8}

;--- unknown.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_unknown(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition, <4 x i32> addrspace(2)* %unknown) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* %unknown
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- layout.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
%Wrong = type { [8 x <4 x double>] }
define floor_fragment i32 @reject_layout(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition, %Wrong addrspace(2)* %wrong) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %b = bitcast %Wrong addrspace(2)* %wrong to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* %b
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- escape.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
declare void @escape(<4 x i32> addrspace(2)*)
define floor_fragment i32 @reject_escape(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %b = bitcast %Buffer addrspace(2)* %second to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* %b
  call void @escape(<4 x i32> addrspace(2)* %b)
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- write.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_write(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %b = bitcast %Buffer addrspace(2)* %second to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* %b
  store <4 x i32> zeroinitializer, <4 x i32> addrspace(2)* %b, align 16
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- volatile.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_volatile(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %b = bitcast %Buffer addrspace(2)* %second to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* %b
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load volatile i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- atomic.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_atomic(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %b = bitcast %Buffer addrspace(2)* %second to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* %b
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load atomic i32, i32 addrspace(2)* %lane monotonic, align 4
  ret i32 %value
}

;--- null.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_null(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* null
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- undef.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_undef(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* undef
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- poison.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_poison(%Buffer addrspace(2)* %first, %Buffer addrspace(2)* %second, i1 %condition) {
  %a = bitcast %Buffer addrspace(2)* %first to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %a, <4 x i32> addrspace(2)* poison
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 0, i32 0
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}
