/* Bounded 2D bridge; original NVN/bcdec sources remain unmodified. */
#include "nvn_tex.h"
#include "nvn_deswizzle.h"
#include "nvn_bcdec.h"
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define LIMIT (64u * 1024u * 1024u)
_Static_assert(sizeof(nvn_texdesc) == 40, "NVN descriptor ABI changed");
_Static_assert(offsetof(nvn_texdesc, pkg_block_h) == 36, "NVN descriptor ABI changed");
/* Result words: storage bytes, tight compressed bytes, width, height,
 * Metal pixel format, bytes/pixel, compressed row bytes, compressed rows. */
int texture_info(const nvn_texdesc *d, unsigned level, unsigned layer, uint32_t *out) {
    if (!d || !out)
        return -1;
    if (d->format < 0x41 || d->format > 0x50)
        return -2;
    if (d->target != 1 || d->depth != 1 || layer || d->samples < 0 || d->samples > 1 ||
        (d->flags != 0 && d->flags != 0x10 && d->flags != 0x50))
        return -3;
    if (!d->width || !d->height || d->width > 8192 || d->height > 8192 || !d->levels ||
        d->levels > 14 || level >= d->levels || d->pkg_block_h < 0 || d->pkg_block_h > 6)
        return -1;
    unsigned max_levels = 1, max_dim = d->width > d->height ? d->width : d->height;
    while (max_dim >>= 1)
        max_levels++;
    if (d->levels > max_levels)
        return -1;
    if ((d->flags & 0x10) && (d->levels != 1 || d->pkg_block_h))
        return -3;
    if (!(d->flags & 0x10) && d->stride)
        return -3;
    uint32_t w = d->width >> level, h = d->height >> level, pf;
    if (!w)
        w = 1;
    if (!h)
        h = 1;
    int bw, bh, bpp;
    uint32_t bpb = nvn_fmt_bpb(d->format, &bw, &bh);
    if (!nvn_bc_unpacked(d->format, &pf, &bpp))
        return -2;
    uint32_t row = ((w + 3) / 4) * bpb, rows = (h + 3) / 4;
    if ((d->flags & 0x10) && d->stride && (d->stride < row || d->stride > LIMIT))
        return -1;
    nvn_texlayout layout;
    nvn_tex_layout(d, &layout);
    if (!layout.size || layout.size > LIMIT || (uint64_t)w * h * bpp > LIMIT)
        return -4;
    uint32_t result[8] = {(uint32_t)layout.size, row * rows, w, h, pf, (uint32_t)bpp, row, rows};
    memcpy(out, result, sizeof result);
    return 0;
}

int texture_decode(const nvn_texdesc *d, unsigned level, unsigned layer, const uint8_t *src,
                   uint32_t src_size, uint8_t *dst, uint32_t dst_size) {
    uint32_t m[8];
    int status = texture_info(d, level, layer, m);
    if (status)
        return status;
    if (!src || !dst || src_size != m[0] || dst_size != m[2] * m[3] * m[5])
        return -5;
    uint8_t *linear = malloc(m[1]);
    if (!linear)
        return -4;
    if (d->flags & 0x10) {
        uint32_t align = (d->flags & 0x40) ? 128 : 32;
        uint32_t pitch = d->stride ? d->stride : (m[6] + align - 1) & ~(align - 1);
        for (uint32_t y = 0; y < m[7]; y++)
            memcpy(linear + y * m[6], src + y * pitch, m[6]);
        status = 0;
    } else {
        status = nvn_deswizzle(d, level, layer, src, linear, m[6]);
    }
    if (!status)
        status = nvn_bc_decode(d->format, linear, m[6], m[2], m[3], dst, m[2] * m[5]);
    free(linear);
    return status;
}
