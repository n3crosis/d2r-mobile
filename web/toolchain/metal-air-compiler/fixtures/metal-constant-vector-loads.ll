; Authored synthetic regression, not extracted from any private shader.
; RUN: split-file %s %t
; RUN: opt -enable-new-pm=0 -PointerBCFixup -verify -S %t/reads.ll | FileCheck %s --check-prefix=READ
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/padding.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/regroup.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/escape.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/volatile.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/store.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/atomic.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/device.ll 2>&1 | FileCheck %s --check-prefix=REJECT
; REJECT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions)
;
; This is intentionally a pass-level test: optimizer-generated pointer use
; shapes are not stable enough to require a frontend to produce this exact IR.
; Opt and FileCheck execution is pending CI; no compiler was built or run to
; prepare this fixture.

;--- reads.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

; READ-LABEL: define floor_fragment i32 @indexed_reads(
; READ-NOT: bitcast %Buffer
; READ: %raw.storage = getelementptr %Buffer, %Buffer addrspace(2)* %buffer, i32 0, i32 0, i32 0
; READ: %row.ptr.typed = getelementptr inbounds <4 x float>, <4 x float> addrspace(2)* %raw.storage, i64 %row
; READ: %lane.ptr.typed = getelementptr inbounds <4 x float>, <4 x float> addrspace(2)* %row.ptr.typed, i64 0, i32 %lane
; READ: %next.ptr.typed = getelementptr float, float addrspace(2)* %lane.ptr.typed, i64 %delta
; READ: %word.typed = load float, float addrspace(2)* %next.ptr.typed, align 1
; READ-NOT: !range
; READ: %word.bits = bitcast float %word.typed to i32
; READ: %whole.typed = load <4 x float>, <4 x float> addrspace(2)* %raw.storage, align 16, !invariant.load
; READ: %whole.bits = bitcast <4 x float> %whole.typed to <4 x i32>
; READ: %first = extractelement <4 x i32> %whole.bits, i32 0
; READ: %result = xor i32 %word.bits, %first
; READ: ret i32 %result
; The two load sizes (4 and 16 bytes), original 1/16-byte alignments, dynamic
; row/lane/scalar offsets, and inbounds flags must be retained independently.
define floor_fragment i32 @indexed_reads(%Buffer addrspace(2)* %buffer, i64 %row, i32 %lane, i64 %delta) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %row.ptr = getelementptr inbounds <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 %row
  %lane.ptr = getelementptr inbounds <4 x i32>, <4 x i32> addrspace(2)* %row.ptr, i64 0, i32 %lane
  %next.ptr = getelementptr i32, i32 addrspace(2)* %lane.ptr, i64 %delta
  %word = load i32, i32 addrspace(2)* %next.ptr, align 1, !range !0
  %whole = load <4 x i32>, <4 x i32> addrspace(2)* %raw, align 16, !invariant.load !1
  %first = extractelement <4 x i32> %whole, i32 0
  %result = xor i32 %word, %first
  ret i32 %result
}

; A second root and another function exercise per-function local state and
; direct vector loads; no pointer bitcast is needed in the transformed body.
; READ-LABEL: define floor_fragment <4 x i32> @direct_read(
; READ-NEXT: %raw.storage = getelementptr %Buffer, %Buffer addrspace(2)* %buffer, i32 0, i32 0, i32 0
; READ-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %raw.storage, align 4
; READ-NEXT: %value.bits = bitcast <4 x float> %value.typed to <4 x i32>
; READ-NEXT: ret <4 x i32> %value.bits
define floor_fragment <4 x i32> @direct_read(%Buffer addrspace(2)* %buffer) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %raw, align 4
  ret <4 x i32> %value
}
!0 = !{i32 0, i32 8}
!1 = !{}

;--- padding.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Padded = type { i8, [8 x <4 x float>] }
define floor_fragment i32 @reject_padding(%Padded addrspace(2)* %buffer) {
  %raw = bitcast %Padded addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 0, i32 1
  %value = load i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- regroup.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i64 @reject_lane_regrouping(%Buffer addrspace(2)* %buffer) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <2 x i64> addrspace(2)*
  %lane = getelementptr <2 x i64>, <2 x i64> addrspace(2)* %raw, i64 0, i32 1
  %value = load i64, i64 addrspace(2)* %lane, align 8
  ret i64 %value
}

;--- escape.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
declare void @escape(i32 addrspace(2)*)
define floor_fragment void @reject_escape(%Buffer addrspace(2)* %buffer) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 0, i32 1
  %also.read = load <4 x i32>, <4 x i32> addrspace(2)* %raw, align 16
  call void @escape(i32 addrspace(2)* %lane)
  ret void
}

;--- volatile.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_volatile(%Buffer addrspace(2)* %buffer) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 0, i32 1
  %value = load volatile i32, i32 addrspace(2)* %lane, align 4
  ret i32 %value
}

;--- store.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment void @reject_store(%Buffer addrspace(2)* %buffer, i32 %value) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 0, i32 1
  store i32 %value, i32 addrspace(2)* %lane, align 4
  ret void
}

;--- atomic.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_atomic(%Buffer addrspace(2)* %buffer) {
  %raw = bitcast %Buffer addrspace(2)* %buffer to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 0, i32 1
  %value = load atomic i32, i32 addrspace(2)* %lane acquire, align 4
  ret i32 %value
}

;--- device.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
define floor_fragment i32 @reject_nonconstant_address_space(%Buffer addrspace(1)* %buffer) {
  %raw = bitcast %Buffer addrspace(1)* %buffer to <4 x i32> addrspace(1)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(1)* %raw, i64 0, i32 1
  %value = load i32, i32 addrspace(1)* %lane, align 4
  ret i32 %value
}
