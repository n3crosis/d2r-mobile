// 有界 ASTC 实验；不是游戏转换管线。
// Bounded ASTC experiment; not the game conversion pipeline.
// 基于 Arm astc-encoder 5.0.0 API 和原生 astc_pack.py 参数。
// Based on the Arm astc-encoder 5.0.0 API and native astc_pack.py settings.
#include "astcenc.h"
#include <cstddef>
#include <cstdint>

extern "C" {
// 原始块字节，不含 .astc 容器头。零表示尺寸无效。
// Raw block bytes, without an .astc container header. Zero means invalid dimensions.
uint32_t astc_output_size(uint32_t width, uint32_t height) {
    if (!width || !height || width > 4096 || height > 4096 ||
        static_cast<uint64_t>(width) * height > 1048576)
        return 0;
    return ((width + 3) / 4) * ((height + 3) / 4) * 16;
}

// 调用者拥有有效、不重叠的缓冲区；配置 0 = 线性，1 = sRGB。
// Caller owns valid, nonoverlapping buffers; profile 0 = linear, 1 = sRGB.
// 成功返回 0，输入无效返回 -1，否则返回 100 + 上游错误码。
// Returns 0 on success, -1 on invalid input, or 100 + upstream error.
int astc_encode_rgba(const uint8_t *rgba, uint32_t rgba_size, uint32_t width, uint32_t height,
                     uint32_t profile, uint8_t *output, uint32_t output_size) {
    const uint32_t required = astc_output_size(width, height);
    if (!required || !rgba || !output || profile > 1 || output_size != required ||
        rgba_size != static_cast<uint64_t>(width) * height * 4)
        return -1;
    astcenc_config config;
    auto status = astcenc_config_init(profile ? ASTCENC_PRF_LDR_SRGB : ASTCENC_PRF_LDR, 4, 4, 1,
                                      ASTCENC_PRE_THOROUGH, 0, &config);
    if (status != ASTCENC_SUCCESS)
        return 100 + status;
    astcenc_context *context = nullptr;
    status = astcenc_context_alloc(&config, 1, &context);
    if (status != ASTCENC_SUCCESS)
        return 100 + status;
    void *slice = const_cast<uint8_t *>(rgba);
    astcenc_image image{width, height, 1, ASTCENC_TYPE_U8, &slice};
    const astcenc_swizzle swizzle{ASTCENC_SWZ_R, ASTCENC_SWZ_G, ASTCENC_SWZ_B, ASTCENC_SWZ_A};
    status = astcenc_compress_image(context, &image, &swizzle, output, output_size, 0);
    astcenc_context_free(context);
    return status == ASTCENC_SUCCESS ? 0 : 100 + status;
}
}
