#include "air_compiler.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/SourceManager.h"
#include "clang/AST/Attr.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/MultiplexConsumer.h"
#include "clang/Lex/PPCallbacks.h"
#include "clang/Lex/Preprocessor.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/Bitcode/BitcodeWriter.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/VirtualFileSystem.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <memory>
#include <new>
#include <string>
#include <vector>

struct air_result {
  uint32_t status = AIR_OK;
  std::vector<uint8_t> data;
  std::string diagnostics;
};
namespace {
#include "compat_header.inc"
constexpr size_t SourceLimit = 4 * 1024 * 1024;
constexpr size_t OutputLimit = 64 * 1024 * 1024;
constexpr size_t DiagnosticLimit = 64 * 1024;
void appendDiagnostic(air_result &r, llvm::StringRef text) {
  const auto count = std::min(text.size(), DiagnosticLimit - r.diagnostics.size());
  r.diagnostics.append(text.data(), count);
}
class Diagnostics final : public clang::DiagnosticConsumer {
  air_result &result;
public:
  explicit Diagnostics(air_result &r) : result(r) {}
  void HandleDiagnostic(clang::DiagnosticsEngine::Level level,
                        const clang::Diagnostic &diagnostic) override {
    clang::DiagnosticConsumer::HandleDiagnostic(level, diagnostic);
    llvm::SmallString<256> message;
    diagnostic.FormatDiagnostic(message);
    appendDiagnostic(result, message);
    appendDiagnostic(result, "\n");
  }
};
/* A bounded output stream avoids allocating an unbounded result before a check.
 * Overflow does not turn partial output into a successful library.
 */
class Output final : public llvm::raw_ostream {
  std::vector<uint8_t> &bytes;
  bool exceeded = false;
  uint64_t position = 0;
  void write_impl(const char *data, size_t size) override {
    position += size;
    if (exceeded || size > OutputLimit - bytes.size()) {
      exceeded = true;
      return;
    }
    bytes.insert(bytes.end(), data, data + size);
  }
  uint64_t current_pos() const override { return position; }
public:
  explicit Output(std::vector<uint8_t> &data) : bytes(data) { SetUnbuffered(); }
  bool overflowed() const { return exceeded; }
};
class RejectAssembly final : public clang::RecursiveASTVisitor<RejectAssembly> {
  bool trustedMathDeclaration(clang::NamedDecl *decl, const clang::AsmLabelAttr *attr) {
    auto *function = llvm::dyn_cast<clang::FunctionDecl>(decl);
    if (!function || function->isVariadic() || function->hasBody()) return false;
    const auto &sm = decl->getASTContext().getSourceManager();
    auto trusted = [&](clang::SourceLocation loc) {
      if (loc.isInvalid() || loc.isMacroID()) return false;
      auto file = sm.getFileEntryRefForID(sm.getFileID(loc));
      return file && file->getName() == "/include/metal_math";
    };
    if (!trusted(sm.getSpellingLoc(decl->getLocation())) ||
        !trusted(sm.getExpansionLoc(decl->getLocation())) ||
        !trusted(attr->getLocation()) || decl->getLocation().isMacroID()) return false;
    unsigned count = 0;
    const auto name = attr->getLabel();
    for (const auto candidate : {"air.fast_sqrt.f32", "air.fast_rsqrt.f32",
          "air.fast_exp2.f32", "air.fast_log2.f32", "air.fast_floor.f32",
          "air.fast_trunc.f32", "air.fast_rint.f32", "air.fast_fabs.f32"})
      if (name == candidate) count = 1;
    if (name == "air.fast_fmin.f32" || name == "air.fast_fmax.f32") count = 2;
    if (name == "air.fast_clamp.f32" || name == "air.fma.f32") count = 3;
    if (!count || function->getNumParams() != count ||
        !function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::Float)) return false;
    for (const auto *parameter : function->parameters())
      if (!parameter->getType()->isSpecificBuiltinType(clang::BuiltinType::Float)) return false;
    return true;
  }
public:
  bool rejected = false;
  bool VisitNamedDecl(clang::NamedDecl *decl) {
    if (const auto *attr = decl->getAttr<clang::AsmLabelAttr>())
      rejected |= !trustedMathDeclaration(decl, attr);
    return !rejected;
  }
  bool VisitFileScopeAsmDecl(clang::FileScopeAsmDecl *) { rejected = true; return false; }
  bool VisitGCCAsmStmt(clang::GCCAsmStmt *) { rejected = true; return false; }
  bool VisitMSAsmStmt(clang::MSAsmStmt *) { rejected = true; return false; }
};
class ValidateSource final : public clang::ASTConsumer {
  clang::DiagnosticsEngine &diagnostics;
  bool rejected = false;
  bool check(clang::Decl *decl) {
    if (rejected) return false;
    RejectAssembly assembly;
    assembly.TraverseDecl(decl);
    if (assembly.rejected) {
      rejected = true;
      diagnostics.Report(diagnostics.getCustomDiagID(
          clang::DiagnosticsEngine::Error,
          "assembly and assembly symbol labels are unsupported"));
    }
    return !rejected;
  }
public:
  explicit ValidateSource(clang::DiagnosticsEngine &d) : diagnostics(d) {}
  bool HandleTopLevelDecl(clang::DeclGroupRef group) override {
    for (auto *decl : group) if (!check(decl)) return false;
    return true;
  }
  void HandleTranslationUnit(clang::ASTContext &context) override {
    check(context.getTranslationUnitDecl());
  }
};
// Protect semantic diagnostics while preserving ordinary warning pragmas.
// The callback runs after Clang applies each diagnostic pragma. Reasserting
// these mappings also covers umbrella groups such as -Weverything.
class ProtectSemanticDiagnostics final : public clang::PPCallbacks {
  clang::DiagnosticsEngine &diagnostics;
  void protect(clang::SourceLocation location) {
    for (const char *group : {"unknown-attributes", "ignored-attributes", "unknown-pragmas"})
      diagnostics.setSeverityForGroup(clang::diag::Flavor::WarningOrError,
          group, clang::diag::Severity::Error, location);
  }
public:
  explicit ProtectSemanticDiagnostics(clang::DiagnosticsEngine &d) : diagnostics(d) {}
  void PragmaDiagnostic(clang::SourceLocation location, llvm::StringRef,
                        clang::diag::Severity, llvm::StringRef) override {
    protect(location);
  }
  void PragmaDiagnosticPop(clang::SourceLocation location, llvm::StringRef) override {
    protect(location);
  }
};
class CheckedLLVMAction final : public clang::EmitLLVMOnlyAction {
public:
  explicit CheckedLLVMAction(llvm::LLVMContext *context)
      : clang::EmitLLVMOnlyAction(context) {}
protected:
  std::unique_ptr<clang::ASTConsumer> CreateASTConsumer(
      clang::CompilerInstance &compiler, llvm::StringRef file) override {
    compiler.getPreprocessor().addPPCallbacks(
        std::make_unique<ProtectSemanticDiagnostics>(compiler.getDiagnostics()));
    auto codegen = clang::EmitLLVMOnlyAction::CreateASTConsumer(compiler, file);
    if (!codegen) return nullptr;
    std::vector<std::unique_ptr<clang::ASTConsumer>> consumers;
    consumers.push_back(std::make_unique<ValidateSource>(compiler.getDiagnostics()));
    consumers.push_back(std::move(codegen));
    return std::make_unique<clang::MultiplexConsumer>(std::move(consumers));
  }
};
bool hasEntry(const llvm::Module &module) {
  for (const auto *name : {"air.kernel", "air.vertex", "air.fragment"})
    if (const auto *node = module.getNamedMetadata(name))
      if (node->getNumOperands()) return true;
  return false;
}
}

static air_result *compile(const uint8_t *source, size_t source_size,
                                     uint32_t ios_major, uint32_t output_kind, uint32_t math_profile) {
  auto result = std::unique_ptr<air_result>(new (std::nothrow) air_result());
  if (!result) return nullptr;
  if (!source || !source_size || source_size > SourceLimit) {
    result->status = AIR_BAD_INPUT;
    appendDiagnostic(*result, "Source must contain between 1 and 4194304 bytes.\n");
    return result.release();
  }
  if ((ios_major != 18 && ios_major != 26) || output_kind > AIR_LLVM_TEXT || math_profile > 1) {
    result->status = AIR_BAD_OPTIONS;
    appendDiagnostic(*result, "Unsupported target or output kind.\n");
    return result.release();
  }
  Diagnostics diagnostic(*result);
  clang::CompilerInstance compiler;
  compiler.createDiagnostics(&diagnostic, false);
  auto invocation = std::make_shared<clang::CompilerInvocation>();
  const char *triple = ios_major == 18 ? "air64-apple-ios18.0.0" : "air64-apple-ios26.0.0";
  std::vector<const char *> args = {
    "-triple", triple, "-x", "metal", "-std=metal3.0", "-O2",
    "-flegacy-pass-manager", "-emit-llvm", "-nostdsysteminc", "-nobuiltininc",
    "-I/include", "-include", "metal_stdlib",
    "-Werror=unknown-attributes", "-Werror=ignored-attributes",
    "-Werror=unknown-pragmas", "-ferror-limit", "20", "/input/shader.metal"
  };
  if (math_profile == 1) {
    for (const char *flag : {"-DD2R_AIR_FAST_MATH=1", "-cl-single-precision-constant", "-ffast-math", "-ffp-contract=fast",
        "-fno-signed-zeros", "-menable-no-infs", "-menable-no-nans"}) args.insert(args.end() - 1, flag);
  }
  if (!clang::CompilerInvocation::CreateFromArgs(*invocation, args,
                                                compiler.getDiagnostics())) {
    result->status = AIR_BAD_OPTIONS;
    return result.release();
  }
  compiler.setInvocation(std::move(invocation));
  clang::ProcessWarningOptions(compiler.getDiagnostics(), compiler.getDiagnosticOpts());
  auto filesystem = llvm::makeIntrusiveRefCnt<llvm::vfs::InMemoryFileSystem>();
  filesystem->setCurrentWorkingDirectory("/");
  filesystem->addFile("/input/shader.metal", 0,
      llvm::MemoryBuffer::getMemBufferCopy(
          llvm::StringRef(reinterpret_cast<const char *>(source), source_size),
          "/input/shader.metal"));
  for (const auto &header : CompatibilityHeaders)
    filesystem->addFile(header.path, 0, llvm::MemoryBuffer::getMemBufferCopy(header.content, header.path));
  compiler.createFileManager(filesystem);
  compiler.createSourceManager(compiler.getFileManager());
  llvm::LLVMContext context;
  CheckedLLVMAction action(&context);
  if (!compiler.ExecuteAction(action) || compiler.getDiagnostics().hasErrorOccurred()) {
    result->status = AIR_FRONTEND_FAILED;
    return result.release();
  }
  auto module = action.takeModule();
  if (!module) {
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, "Frontend did not produce an LLVM module.\n");
    return result.release();
  }
  std::string verification;
  llvm::raw_string_ostream errors(verification);
  if (llvm::verifyModule(*module, &errors)) {
    errors.flush();
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, verification);
    return result.release();
  }
  if (!hasEntry(*module)) {
    result->status = AIR_NO_ENTRY;
    appendDiagnostic(*result, "No AIR entry point was generated.\n");
    return result.release();
  }
  for (const auto &function : *module) {
    if (function.isDeclaration() && !function.isIntrinsic() &&
        !function.getName().startswith("air.")) {
      result->status = AIR_UNRESOLVED_SYMBOL;
      appendDiagnostic(*result, "Unresolved external function: ");
      appendDiagnostic(*result, function.getName());
      appendDiagnostic(*result, "\n");
      return result.release();
    }
  }
  for (const auto &global : module->globals()) {
    if (global.isDeclaration()) {
      result->status = AIR_UNRESOLVED_SYMBOL;
      appendDiagnostic(*result, "Unresolved external global: ");
      appendDiagnostic(*result, global.getName());
      appendDiagnostic(*result, "\n");
      return result.release();
    }
  }
  Output output(result->data);
  if (output_kind == AIR_LLVM_TEXT)
    module->print(output, nullptr);
  else
    llvm::WriteMetalLibToFile(*module, output);
  output.flush();
  if (output.overflowed()) {
    result->data.clear();
    result->status = AIR_OUTPUT_LIMIT;
    appendDiagnostic(*result, "Compiled output exceeded 67108864 bytes.\n");
  }
  return result.release();
}
extern "C" uint32_t air_result_status(const air_result *r) {
  return r ? r->status : AIR_BAD_INPUT;
}
extern "C" const uint8_t *air_result_data(const air_result *r) {
  return r && !r->data.empty() ? r->data.data() : nullptr;
}
extern "C" size_t air_result_size(const air_result *r) { return r ? r->data.size() : 0; }
extern "C" const char *air_result_diagnostics(const air_result *r) {
  return r ? r->diagnostics.c_str() : "No compilation result.";
}
extern "C" size_t air_result_diagnostics_size(const air_result *r) {
  return r ? r->diagnostics.size() : sizeof("No compilation result.") - 1;
}
extern "C" void air_result_free(air_result *r) { delete r; }

extern "C" const char *air_compiler_header_sha256(void) { return CompatibilityHeaderSHA256; }

extern "C" air_result *air_compile_v1(const uint8_t *source, size_t size, uint32_t ios, uint32_t output) {
  return compile(source, size, ios, output, 0);
}
extern "C" air_result *air_compile_v2(const uint8_t *source, size_t size, uint32_t ios, uint32_t output, uint32_t math_profile) {
  return compile(source, size, ios, output, math_profile);
}
extern "C" uint32_t air_compiler_header_bundle_version(void) { return 2; }
