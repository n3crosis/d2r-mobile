// 基于固定 Arm 5.0.0 API，使用自造 RGBA 验证桥接编码与解码；不代表 WASM 验证。
// Tests bridge encoding and decoding with synthetic RGBA against pinned Arm 5.0.0; not WASM
// validation.
#include "astcenc.h"
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <utility>
#include <vector>

extern "C" uint32_t astc_output_size(uint32_t, uint32_t);
extern "C" int astc_encode_rgba(const uint8_t *, uint32_t, uint32_t, uint32_t, uint32_t, uint8_t *,
                                uint32_t);
static void check(bool condition, const char *message) {
    if (!condition) {
        std::cerr << message << '\n';
        std::exit(1);
    }
}
int main() {
    check(astc_output_size(0, 4) == 0, "Reject zero width");
    check(astc_output_size(4097, 1) == 0, "Reject width limit");
    check(astc_output_size(2048, 2048) == 0, "Reject pixel limit");
    check(astc_output_size(UINT32_MAX, UINT32_MAX) == 0, "Reject overflow dimensions");
    check(astc_output_size(5, 7) == 64, "Partial blocks size");
    uint8_t small[64] = {};
    check(astc_encode_rgba(small, 64, 4, 4, 2, small, 16) == -1, "Reject profile");
    check(astc_encode_rgba(small, 63, 4, 4, 0, small, 16) == -1, "Reject input length");
    check(astc_encode_rgba(small, 64, 4, 4, 0, small, 15) == -1, "Reject output length");
    check(astc_encode_rgba(nullptr, 64, 4, 4, 0, small, 16) == -1, "Reject null input");
    for (uint32_t profile = 0; profile < 2; ++profile) {
        for (auto dimensions : {std::pair<uint32_t, uint32_t>{1, 1}, {4, 4}, {5, 7}, {17, 3}}) {
            const auto w = dimensions.first, h = dimensions.second;
            for (bool gradient : {false, true}) {
                std::vector<uint8_t> input(w * h * 4), decoded(input.size());
                for (uint32_t y = 0; y < h; ++y) {
                    for (uint32_t x = 0; x < w; ++x) {
                        auto at = (y * w + x) * 4;
                        input[at] = gradient ? x * 255 / (w > 1 ? w - 1 : 1) : 255;
                        input[at + 1] = gradient ? y * 255 / (h > 1 ? h - 1 : 1) : 0;
                        input[at + 2] = 0;
                        input[at + 3] = gradient ? (x + y) * 255 / (w + h - 1) : 255;
                    }
                }
                std::vector<uint8_t> blocks(astc_output_size(w, h));
                check(astc_encode_rgba(input.data(), input.size(), w, h, profile, blocks.data(),
                                       blocks.size()) == 0,
                      "Bridge encode");
                astcenc_config config;
                check(astcenc_config_init(profile ? ASTCENC_PRF_LDR_SRGB : ASTCENC_PRF_LDR, 4, 4, 1,
                                          ASTCENC_PRE_THOROUGH, ASTCENC_FLG_DECOMPRESS_ONLY,
                                          &config) == ASTCENC_SUCCESS,
                      "Decode config");
                astcenc_context *context = nullptr;
                check(astcenc_context_alloc(&config, 1, &context) == ASTCENC_SUCCESS,
                      "Decode context");
                void *slice = decoded.data();
                astcenc_image image{w, h, 1, ASTCENC_TYPE_U8, &slice};
                const astcenc_swizzle swizzle{ASTCENC_SWZ_R, ASTCENC_SWZ_G, ASTCENC_SWZ_B,
                                              ASTCENC_SWZ_A};
                const auto status = astcenc_decompress_image(context, blocks.data(), blocks.size(),
                                                             &image, &swizzle, 0);
                astcenc_context_free(context);
                check(status == ASTCENC_SUCCESS, "Decode blocks");
                double squared_error = 0;
                for (size_t i = 0; i < input.size(); ++i) {
                    const double difference = static_cast<double>(input[i]) - decoded[i];
                    squared_error += difference * difference;
                }
                if (!gradient)
                    check(input == decoded, "Solid RGBA must round trip exactly");
                const double psnr =
                    squared_error == 0
                        ? 99
                        : 10 * std::log10(255.0 * 255.0 * input.size() / squared_error);
                check(psnr >= 20, "Synthetic gradient PSNR below smoke threshold");
                std::cout << "profile=" << profile << " size=" << w << 'x' << h
                          << " gradient=" << gradient << " bytes=" << blocks.size()
                          << " psnr=" << psnr << '\n';
            }
        }
    }
    std::cout << "Native smoke: 16 synthetic round trips passed; WASM unverified\n";
}
