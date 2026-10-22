; Independently authored public symbolic LLVM regression fixtures.
; No private shader source/IR is included. These files describe compiler IR;
; they do not read host memory or execute generated GPU shader instructions.
; RUN: split-file %s %t
; RUN: opt -enable-new-pm=0 -PointerBCFixup -verify -S %t/slots.ll | FileCheck %s --check-prefix=POS --implicit-check-not='= bitcast {{.*}} addrspace' --implicit-check-not='= load {{.*}} addrspace({{[0-9]+}})*,'
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/unknown_slot.ll 2>&1 | FileCheck %s --check-prefix=REJECT-UNKNOWN-SLOT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/raw_byte_slot.ll 2>&1 | FileCheck %s --check-prefix=REJECT-RAW-BYTE-SLOT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/nonzero_pointer_field.ll 2>&1 | FileCheck %s --check-prefix=REJECT-NONZERO-POINTER-FIELD
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/wrong_inner_as.ll 2>&1 | FileCheck %s --check-prefix=REJECT-WRONG-INNER-AS
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/unproved_addrspacecast.ll 2>&1 | FileCheck %s --check-prefix=REJECT-UNPROVED-ADDRSPACECAST
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/wrong_layout.ll 2>&1 | FileCheck %s --check-prefix=REJECT-WRONG-LAYOUT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/empty_slot_array.ll 2>&1 | FileCheck %s --check-prefix=REJECT-EMPTY-SLOT-ARRAY
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/volatile_slot.ll 2>&1 | FileCheck %s --check-prefix=REJECT-VOLATILE-SLOT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/atomic_slot.ll 2>&1 | FileCheck %s --check-prefix=REJECT-ATOMIC-SLOT
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/shifted_reverse.ll 2>&1 | FileCheck %s --check-prefix=REJECT-SHIFTED-REVERSE
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/nonexact_reverse.ll 2>&1 | FileCheck %s --check-prefix=REJECT-NONEXACT-REVERSE
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/native_escape.ll 2>&1 | FileCheck %s --check-prefix=REJECT-NATIVE-ESCAPE
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/native_write.ll 2>&1 | FileCheck %s --check-prefix=REJECT-NATIVE-WRITE
; RUN: not opt -enable-new-pm=0 -PointerBCFixup -disable-output %t/padded_wrapper.ll 2>&1 | FileCheck %s --check-prefix=REJECT-PADDED-WRAPPER
; REJECT-PADDED-WRAPPER: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: root wrapper layout mismatch
; All negatives retain a direct select user at the unchanged legacy guard.
; They assert actual compiler rejection, not merely refusal by the new helper.
; This file is authored for CI. No compiler/verifier execution is claimed.
; REJECT-UNKNOWN-SLOT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-RAW-BYTE-SLOT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-NONZERO-POINTER-FIELD: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-WRONG-INNER-AS: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-UNPROVED-ADDRSPACECAST: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-WRONG-LAYOUT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: root vector element type mismatch
; REJECT-EMPTY-SLOT-ARRAY: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-VOLATILE-SLOT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-ATOMIC-SLOT: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved pointer slot
; REJECT-SHIFTED-REVERSE: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved reverse pointer slot
; REJECT-NONEXACT-REVERSE: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unproved reverse pointer slot
; REJECT-NATIVE-ESCAPE: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unsupported native-view user
; REJECT-NATIVE-WRITE: invalid pointer bitcast: failed to run bitcast fixup (unhandled instructions); unsupported users: select; constant-vector graph: unsupported native-view user

;--- slots.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
%Arguments = type { %Buffer addrspace(2)*, i64 }
%PackedArguments = type <{ %Buffer addrspace(2)*, i8 }>
%PointerRow = type { [3 x %Buffer addrspace(2)*] }
%NestedSlots = type { [2 x %PointerRow], i64 }

; The outer slot AS1 is distinct from the AS2 pointer stored in it. Explicit
; alignment 1 and pointer-valued metadata must survive the single slot load.
; POS-LABEL: define floor_fragment <4 x i32> @direct_slot(
; POS: %raw.storage = getelementptr %Buffer, %Buffer addrspace(2)* %base, i32 0, i32 0, i32 0
; POS-NEXT: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(1)* %slot, align 1, !invariant.load ![[EMPTY:[0-9]+]], !nonnull ![[EMPTY]], !dereferenceable ![[BYTES:[0-9]+]], !align ![[BYTES]]
; POS-NEXT: %loaded.storage = getelementptr %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %raw.storage, <4 x float> addrspace(2)* %loaded.storage
; POS-NEXT: %row.typed = getelementptr inbounds <4 x float>, <4 x float> addrspace(2)* %chosen.typed, i64 %index
; POS-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %row.typed, align 4
; POS-NEXT: %value.bits = bitcast <4 x float> %value.typed to <4 x i32>
; POS-NEXT: ret <4 x i32> %value.bits
define floor_fragment <4 x i32> @direct_slot(%Buffer addrspace(2)* %base, %Buffer addrspace(2)* addrspace(1)* %slot, i1 %condition, i64 %index) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(1)* %slot to <4 x i32> addrspace(2)* addrspace(1)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(1)* %cast.slot, align 1, !invariant.load !0, !nonnull !0, !dereferenceable !1, !align !2
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %row = getelementptr inbounds <4 x i32>, <4 x i32> addrspace(2)* %chosen, i64 %index
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %row, align 4
  ret <4 x i32> %value
}

; The packed argument record has another field and only byte alignment. This is a pointer-sized field-zero
; read, not a claim that the whole argument record is a vector buffer wrapper.
; POS-LABEL: define floor_fragment <4 x i32> @folded_record(
; POS: %loaded.slot = getelementptr %PackedArguments, %PackedArguments addrspace(2)* %args, i32 0, i32 0
; POS-NEXT: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %loaded.slot, align 1
; POS-NEXT: %loaded.storage = getelementptr %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %loaded.storage, <4 x float> addrspace(2)* %raw.storage
; POS-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %chosen.typed, align 16
define floor_fragment <4 x i32> @folded_record(%Buffer addrspace(2)* %base, %PackedArguments addrspace(2)* %args, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %PackedArguments addrspace(2)* %args to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 1
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %loaded, <4 x i32> addrspace(2)* %raw
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

; POS-LABEL: define floor_fragment <4 x i32> @nested_slot(
; POS: %loaded.slot = getelementptr %NestedSlots, %NestedSlots addrspace(2)* %args, i32 0, i32 0, i32 0, i32 0, i32 0
; POS-NEXT: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %loaded.slot, align 8
; POS-NEXT: %loaded.storage = getelementptr %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i32 0
; POS: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %raw.storage, <4 x float> addrspace(2)* %loaded.storage
define floor_fragment <4 x i32> @nested_slot(%Buffer addrspace(2)* %base, %NestedSlots addrspace(2)* %args, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %NestedSlots addrspace(2)* %args to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

; A slot may already store the exact canonical vector pointer.
; POS-LABEL: define floor_fragment <4 x i32> @vector_slot(
; POS: %loaded.pointer = load <4 x float> addrspace(2)*, <4 x float> addrspace(2)* addrspace(2)* %slot, align 8
; POS-NEXT: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %raw.storage, <4 x float> addrspace(2)* %loaded.pointer
define floor_fragment <4 x i32> @vector_slot(%Buffer addrspace(2)* %base, <4 x float> addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast <4 x float> addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

; Scalar pointer recovery must not invent a vector grouping or change strides.
; POS-LABEL: define floor_fragment i32 @scalar_slot(
; POS: %lane.typed = getelementptr <4 x float>, <4 x float> addrspace(2)* %raw.storage, i64 %row, i32 %lane.index
; POS-NEXT: %loaded.pointer = load float addrspace(2)*, float addrspace(2)* addrspace(2)* %slot, align 8
; POS-NEXT: %chosen.typed = select i1 %condition, float addrspace(2)* %lane.typed, float addrspace(2)* %loaded.pointer
; POS-NEXT: %value.typed = load float, float addrspace(2)* %chosen.typed, align 4
define floor_fragment i32 @scalar_slot(%Buffer addrspace(2)* %base, float addrspace(2)* addrspace(2)* %slot, i1 %condition, i64 %row, i32 %lane.index) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %lane = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %raw, i64 %row, i32 %lane.index
  %cast.slot = bitcast float addrspace(2)* addrspace(2)* %slot to i32 addrspace(2)* addrspace(2)*
  %loaded = load i32 addrspace(2)*, i32 addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, i32 addrspace(2)* %lane, i32 addrspace(2)* %loaded
  %value = load i32, i32 addrspace(2)* %chosen, align 4
  ret i32 %value
}

; One recovered pointer feeds both integer-view reads and an exact native
; recast. Native aggregate GEPs, block edges and index widths stay untouched.
; POS-LABEL: define floor_fragment <4 x float> @exact_reverse_mixed(
; POS: entry:
; POS-NEXT: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %slot, align 8
; POS-NEXT: %loaded.storage = getelementptr %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %words.typed = load <4 x float>, <4 x float> addrspace(2)* %loaded.storage, align 16
; POS-NEXT: %words.bits = bitcast <4 x float> %words.typed to <4 x i32>
; POS-NEXT: %as.float = bitcast <4 x i32> %words.bits to <4 x float>
; POS-NEXT: br i1 %condition, label %left, label %right
; POS: merge:
; POS-NEXT: %native = phi %Buffer addrspace(2)* [ %loaded.pointer, %left ], [ %other, %right ]
; POS-NEXT: %native.row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %native, i32 0, i32 0, i64 %row
; POS-NEXT: %value = load <4 x float>, <4 x float> addrspace(2)* %native.row, align 4
define floor_fragment <4 x float> @exact_reverse_mixed(%Buffer addrspace(2)* addrspace(2)* %slot, %Buffer addrspace(2)* %other, i1 %condition, i64 %row) {
entry:
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %words = load <4 x i32>, <4 x i32> addrspace(2)* %loaded, align 16
  %as.float = bitcast <4 x i32> %words to <4 x float>
  %back = bitcast <4 x i32> addrspace(2)* %loaded to %Buffer addrspace(2)*
  br i1 %condition, label %left, label %right
left:
  br label %merge
right:
  br label %merge
merge:
  %native = phi %Buffer addrspace(2)* [ %back, %left ], [ %other, %right ]
  %native.row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %native, i32 0, i32 0, i64 %row
  %value = load <4 x float>, <4 x float> addrspace(2)* %native.row, align 4
  %sum = fadd <4 x float> %value, %as.float
  ret <4 x float> %sum
}

; Native-only inverse recovery must also retain one load and loop PHI edges.
; POS-LABEL: define floor_fragment float @exact_reverse_native_only(
; POS: %loaded.slot = getelementptr %Arguments, %Arguments addrspace(2)* %args, i32 0, i32 0
; POS-NEXT: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %loaded.slot, align 1
; POS: loop:
; POS-NEXT: %native = phi %Buffer addrspace(2)* [ %loaded.pointer, %entry ], [ %next, %loop ]
; POS-NEXT: %next = select i1 %switch, %Buffer addrspace(2)* %other, %Buffer addrspace(2)* %native
; POS: %native.lane = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %native, i32 0, i32 0, i64 %row, i32 2
; POS-NEXT: %value = load float, float addrspace(2)* %native.lane, align 4
define floor_fragment float @exact_reverse_native_only(%Arguments addrspace(2)* %args, %Buffer addrspace(2)* %other, i1 %switch, i1 %again, i64 %row) {
entry:
  %cast.slot = bitcast %Arguments addrspace(2)* %args to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 1
  %back = bitcast <4 x i32> addrspace(2)* %loaded to %Buffer addrspace(2)*
  br label %loop
loop:
  %native = phi %Buffer addrspace(2)* [ %back, %entry ], [ %next, %loop ]
  %next = select i1 %switch, %Buffer addrspace(2)* %other, %Buffer addrspace(2)* %native
  br i1 %again, label %loop, label %exit
exit:
  %native.lane = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %native, i32 0, i32 0, i64 %row, i32 2
  %value = load float, float addrspace(2)* %native.lane, align 4
  ret float %value
}

; A live shared slot cast must remain in the outer worklist. Only the first
; load belongs to the rewritten graph; the second is unchanged legacy input.
; POS-LABEL: define floor_fragment <4 x i32> @shared_slot_cast(
; POS: %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
; POS-NEXT: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %slot, align 8
; POS-NEXT: %loaded.storage = getelementptr %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %unrelated = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
; POS: %other.value = load <4 x i32>, <4 x i32> addrspace(2)* %unrelated, align 16
define floor_fragment <4 x i32> @shared_slot_cast(%Buffer addrspace(2)* %base, %Buffer addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %unrelated = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  %other.value = load <4 x i32>, <4 x i32> addrspace(2)* %unrelated, align 16
  %sum = add <4 x i32> %value, %other.value
  ret <4 x i32> %sum
}

; Two consumed loads share the same slot cast. Both keep their original sites,
; and the now-dead slot cast is removed exactly once after both loads are gone.
; POS-LABEL: define floor_fragment <4 x i32> @shared_consumed_slot(
; POS: %first.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %slot, align 8
; POS-NEXT: %first.storage = getelementptr %Buffer, %Buffer addrspace(2)* %first.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %second.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %slot, align 1
; POS-NEXT: %second.storage = getelementptr %Buffer, %Buffer addrspace(2)* %second.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %loaded.choice.typed = select i1 %condition, <4 x float> addrspace(2)* %first.storage, <4 x float> addrspace(2)* %second.storage
; POS-NEXT: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %raw.storage, <4 x float> addrspace(2)* %loaded.choice.typed
define floor_fragment <4 x i32> @shared_consumed_slot(%Buffer addrspace(2)* %base, %Buffer addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %first = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %second = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 1
  %loaded.choice = select i1 %condition, <4 x i32> addrspace(2)* %first, <4 x i32> addrspace(2)* %second
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded.choice
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

; The inverse recast is replaced before rebuilding a canonical root which
; depends on a native aggregate GEP. The native GEP itself is not reindexed.
; POS-LABEL: define floor_fragment <4 x i32> @native_recast_crosslink(
; POS: %loaded.pointer = load %Buffer addrspace(2)*, %Buffer addrspace(2)* addrspace(2)* %slot, align 8
; POS-NEXT: %loaded.storage = getelementptr %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i32 0
; POS-NEXT: %native.row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %loaded.pointer, i32 0, i32 0, i64 %row
; POS-NEXT: %chosen.typed = select i1 %condition, <4 x float> addrspace(2)* %loaded.storage, <4 x float> addrspace(2)* %native.row
; POS-NEXT: %value.typed = load <4 x float>, <4 x float> addrspace(2)* %chosen.typed, align 4
define floor_fragment <4 x i32> @native_recast_crosslink(%Buffer addrspace(2)* addrspace(2)* %slot, i1 %condition, i64 %row) {
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %back = bitcast <4 x i32> addrspace(2)* %loaded to %Buffer addrspace(2)*
  %native.row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %back, i32 0, i32 0, i64 %row
  %view = bitcast <4 x float> addrspace(2)* %native.row to <4 x i32> addrspace(2)*
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %loaded, <4 x i32> addrspace(2)* %view
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 4
  ret <4 x i32> %value
}

; POS: ![[EMPTY]] = !{}
; POS: ![[BYTES]] = !{i64 16}
!0 = !{}
!1 = !{i64 16}
!2 = !{i64 16}

;--- unknown_slot.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_unknown_slot(%Buffer addrspace(2)* %base, <4 x i32> addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- raw_byte_slot.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_raw_byte_slot(%Buffer addrspace(2)* %base, i8 addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast i8 addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 1
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- nonzero_pointer_field.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
%Nonzero = type { i64, %Buffer addrspace(2)* }

define floor_fragment <4 x i32> @reject_nonzero_pointer_field(%Buffer addrspace(2)* %base, %Nonzero addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Nonzero addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- wrong_inner_as.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_wrong_inner_as(%Buffer addrspace(2)* %base, %Buffer addrspace(1)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Buffer addrspace(1)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- unproved_addrspacecast.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_unproved_addrspacecast(%Buffer addrspace(2)* %base, %Buffer addrspace(2)* addrspace(1)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = addrspacecast %Buffer addrspace(2)* addrspace(1)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- wrong_layout.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
%Wrong = type { [8 x <2 x double>] }

define floor_fragment <4 x i32> @reject_wrong_layout(%Buffer addrspace(2)* %base, %Wrong addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Wrong addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- empty_slot_array.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_empty_slot_array(%Buffer addrspace(2)* %base, [0 x %Buffer addrspace(2)*] addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast [0 x %Buffer addrspace(2)*] addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- volatile_slot.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_volatile_slot(%Buffer addrspace(2)* %base, %Buffer addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load volatile <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- atomic_slot.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x i32> @reject_atomic_slot(%Buffer addrspace(2)* %base, %Buffer addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load atomic <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot monotonic, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}

;--- shifted_reverse.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x float> @reject_shifted_reverse(%Buffer addrspace(2)* addrspace(2)* %slot, %Buffer addrspace(2)* %other, i1 %condition) {
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %offset = getelementptr <4 x i32>, <4 x i32> addrspace(2)* %loaded, i64 1
  %back = bitcast <4 x i32> addrspace(2)* %offset to %Buffer addrspace(2)*
  %chosen = select i1 %condition, %Buffer addrspace(2)* %back, %Buffer addrspace(2)* %other
  %row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %chosen, i32 0, i32 0, i32 0

  %value = load <4 x float>, <4 x float> addrspace(2)* %row, align 16
  ret <4 x float> %value
}

;--- nonexact_reverse.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
%Other = type { [8 x <4 x float>] }

define floor_fragment <4 x float> @reject_nonexact_reverse(%Buffer addrspace(2)* addrspace(2)* %slot, %Other addrspace(2)* %other, i1 %condition) {
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %back = bitcast <4 x i32> addrspace(2)* %loaded to %Other addrspace(2)*
  %chosen = select i1 %condition, %Other addrspace(2)* %back, %Other addrspace(2)* %other
  %row = getelementptr inbounds %Other, %Other addrspace(2)* %chosen, i32 0, i32 0, i32 0

  %value = load <4 x float>, <4 x float> addrspace(2)* %row, align 16
  ret <4 x float> %value
}

;--- native_escape.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
declare void @escape(%Buffer addrspace(2)*)

define floor_fragment <4 x float> @reject_native_escape(%Buffer addrspace(2)* addrspace(2)* %slot, %Buffer addrspace(2)* %other, i1 %condition) {
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %back = bitcast <4 x i32> addrspace(2)* %loaded to %Buffer addrspace(2)*
  %chosen = select i1 %condition, %Buffer addrspace(2)* %back, %Buffer addrspace(2)* %other
  %row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %chosen, i32 0, i32 0, i32 0
  call void @escape(%Buffer addrspace(2)* %chosen)
  %value = load <4 x float>, <4 x float> addrspace(2)* %row, align 16
  ret <4 x float> %value
}

;--- native_write.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }

define floor_fragment <4 x float> @reject_native_write(%Buffer addrspace(2)* addrspace(2)* %slot, %Buffer addrspace(2)* %other, i1 %condition) {
  %cast.slot = bitcast %Buffer addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %back = bitcast <4 x i32> addrspace(2)* %loaded to %Buffer addrspace(2)*
  %chosen = select i1 %condition, %Buffer addrspace(2)* %back, %Buffer addrspace(2)* %other
  %row = getelementptr inbounds %Buffer, %Buffer addrspace(2)* %chosen, i32 0, i32 0, i32 0
  store <4 x float> zeroinitializer, <4 x float> addrspace(2)* %row, align 16
  %value = load <4 x float>, <4 x float> addrspace(2)* %row, align 16
  ret <4 x float> %value
}

;--- padded_wrapper.ll
target datalayout = "e-p:64:64-i64:64-n8:16:32:64"
target triple = "air64-apple-ios18.0.0"
%Buffer = type { [8 x <4 x float>] }
%Padded = type { i32, [8 x <4 x float>] }
define floor_fragment <4 x i32> @reject_padded_wrapper(%Buffer addrspace(2)* %base, %Padded addrspace(2)* addrspace(2)* %slot, i1 %condition) {
  %raw = bitcast %Buffer addrspace(2)* %base to <4 x i32> addrspace(2)*
  %cast.slot = bitcast %Padded addrspace(2)* addrspace(2)* %slot to <4 x i32> addrspace(2)* addrspace(2)*
  %loaded = load <4 x i32> addrspace(2)*, <4 x i32> addrspace(2)* addrspace(2)* %cast.slot, align 8
  %chosen = select i1 %condition, <4 x i32> addrspace(2)* %raw, <4 x i32> addrspace(2)* %loaded
  %value = load <4 x i32>, <4 x i32> addrspace(2)* %chosen, align 16
  ret <4 x i32> %value
}
