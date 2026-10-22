; RUN: split-file %s %t
; RUN: opt -enable-new-pm=0 -instcombine -verify-each -S %t/idiom.ll | FileCheck %s --check-prefix=IDIOM-LLVM
; RUN: opt -enable-new-pm=0 -instcombine -MetalFinal -verify-each -S %t/idiom.ll | FileCheck %s --check-prefix=IDIOM-AIR
; RUN: opt -enable-new-pm=0 -MetalFinal -verify-each -S %t/scalar.ll | FileCheck %s --check-prefix=SCALAR
; RUN: opt -enable-new-pm=0 -MetalFinal -verify-each -S %t/existing.ll | FileCheck %s --check-prefix=EXISTING
; RUN: not opt -enable-new-pm=0 -MetalFinal -disable-output %t/i16.ll 2>&1 | FileCheck %s --check-prefix=WIDTH
; RUN: not opt -enable-new-pm=0 -MetalFinal -disable-output %t/i64.ll 2>&1 | FileCheck %s --check-prefix=WIDTH
; RUN: not opt -enable-new-pm=0 -MetalFinal -disable-output %t/vector.ll 2>&1 | FileCheck %s --check-prefix=WIDTH
; RUN: not opt -enable-new-pm=0 -MetalFinal -disable-output %t/conflict.ll 2>&1 | FileCheck %s --check-prefix=CONFLICT
;
; Independently authored regression. No application shader contents.
; A scalar i32 bit permutation is bit-exact for signed and unsigned values.
; Retargeting the same instruction preserves its name, use, tail kind,
; call-site attributes, annotation and debug location.
;
; IDIOM-LLVM: call i32 @llvm.bitreverse.i32(i32 %value)
; IDIOM-AIR: call i32 @air.reverse_bits.i32(i32 %value)
; SCALAR-LABEL: define i32 @reverse_scalar(
; SCALAR: %reversed = tail call i32 @air.reverse_bits.i32(i32 %value) #[[CALL:[0-9]+]], !dbg ![[LOC:[0-9]+]], !annotation ![[NOTE:[0-9]+]]
; SCALAR-NEXT: ret i32 %reversed
; SCALAR: declare i32 @air.reverse_bits.i32(i32) #[[DECL:[0-9]+]]
; SCALAR-DAG: attributes #[[CALL]] = { "test.call"="kept" }
; SCALAR-DAG: attributes #[[DECL]] = { {{.*}}nounwind{{.*}}readnone{{.*}}speculatable{{.*}}willreturn{{.*}} }
; SCALAR-DAG: ![[LOC]] = !DILocation(line: 2, column: 3,
; SCALAR-DAG: ![[NOTE]] = !{!"kept"}
; EXISTING-LABEL: define i32 @reverse_existing(
; EXISTING: %reversed = call i32 @air.reverse_bits.i32(i32 %value)
; EXISTING: attributes #{{[0-9]+}} = { {{.*}}readnone{{.*}} "existing"="kept" }
; WIDTH: error: unsupported bitreverse type (expected scalar i32)
; CONFLICT: error: incompatible air.reverse_bits.i32 declaration

;--- scalar.ll
source_filename = "authored-bitreverse.ll"
target triple = "air64-apple-ios18.0.0"
declare i32 @llvm.bitreverse.i32(i32)
define i32 @reverse_scalar(i32 %value) !dbg !5 {
  %reversed = tail call i32 @llvm.bitreverse.i32(i32 %value) #1, !dbg !10, !annotation !11
  ret i32 %reversed, !dbg !10
}
attributes #1 = { "test.call"="kept" }
!air.language_version = !{!0}
!llvm.dbg.cu = !{!1}
!llvm.module.flags = !{!2}
!0 = !{!"Metal", i32 3, i32 2, i32 0}
!1 = distinct !DICompileUnit(language: DW_LANG_C, file: !3, producer: "authored", isOptimized: true, runtimeVersion: 0, emissionKind: FullDebug)
!2 = !{i32 2, !"Debug Info Version", i32 3}
!3 = !DIFile(filename: "authored-bitreverse.ll", directory: "/")
!5 = distinct !DISubprogram(name: "reverse_scalar", scope: !3, file: !3, line: 1, type: !6, scopeLine: 1, spFlags: DISPFlagDefinition | DISPFlagOptimized, unit: !1)
!6 = !DISubroutineType(types: !7)
!7 = !{!8, !8}
!8 = !DIBasicType(name: "unsigned int", size: 32, encoding: DW_ATE_unsigned)
!10 = !DILocation(line: 2, column: 3, scope: !5)
!11 = !{!"kept"}

;--- existing.ll
target triple = "air64-apple-ios18.0.0"
declare i32 @llvm.bitreverse.i32(i32)
declare i32 @air.reverse_bits.i32(i32) #0
define i32 @reverse_existing(i32 %value) {
  %reversed = call i32 @llvm.bitreverse.i32(i32 %value)
  ret i32 %reversed
}
attributes #0 = { "existing"="kept" }
!air.language_version = !{!0}
!0 = !{!"Metal", i32 3, i32 2, i32 0}

;--- i16.ll
declare i16 @llvm.bitreverse.i16(i16)
define i16 @unsupported(i16 %value) {
  %reversed = call i16 @llvm.bitreverse.i16(i16 %value)
  ret i16 %reversed
}
!air.language_version = !{!0}
!0 = !{!"Metal", i32 3, i32 2, i32 0}

;--- i64.ll
declare i64 @llvm.bitreverse.i64(i64)
define i64 @unsupported(i64 %value) {
  %reversed = call i64 @llvm.bitreverse.i64(i64 %value)
  ret i64 %reversed
}
!air.language_version = !{!0}
!0 = !{!"Metal", i32 3, i32 2, i32 0}

;--- vector.ll
declare <2 x i32> @llvm.bitreverse.v2i32(<2 x i32>)
define <2 x i32> @unsupported(<2 x i32> %value) {
  %reversed = call <2 x i32> @llvm.bitreverse.v2i32(<2 x i32> %value)
  ret <2 x i32> %reversed
}
!air.language_version = !{!0}
!0 = !{!"Metal", i32 3, i32 2, i32 0}

;--- conflict.ll
declare i32 @llvm.bitreverse.i32(i32)
declare i64 @air.reverse_bits.i32(i64)
define i32 @conflicting_declaration(i32 %value) {
  %reversed = call i32 @llvm.bitreverse.i32(i32 %value)
  ret i32 %reversed
}
!air.language_version = !{!0}
!0 = !{!"Metal", i32 3, i32 2, i32 0}

;--- idiom.ll
target triple = "air64-apple-ios18.0.0"
define i32 @reverse_idiom(i32 %value) {
  %right16 = lshr i32 %value, 16
  %left16 = shl i32 %value, 16
  %swap16 = or i32 %right16, %left16
  %right8 = lshr i32 %swap16, 8
  %low8 = and i32 %right8, 16711935
  %left8 = shl i32 %swap16, 8
  %high8 = and i32 %left8, 4278255360
  %swap8 = or i32 %low8, %high8
  %right4 = lshr i32 %swap8, 4
  %low4 = and i32 %right4, 252645135
  %left4 = shl i32 %swap8, 4
  %high4 = and i32 %left4, 4042322160
  %swap4 = or i32 %low4, %high4
  %right2 = lshr i32 %swap4, 2
  %low2 = and i32 %right2, 858993459
  %left2 = shl i32 %swap4, 2
  %high2 = and i32 %left2, 3435973836
  %swap2 = or i32 %low2, %high2
  %right1 = lshr i32 %swap2, 1
  %low1 = and i32 %right1, 1431655765
  %left1 = shl i32 %swap2, 1
  %high1 = and i32 %left1, 2863311530
  %swap1 = or i32 %low1, %high1
  ret i32 %swap1
}
!air.language_version = !{!0}
!0 = !{!"Metal", i32 3, i32 2, i32 0}
