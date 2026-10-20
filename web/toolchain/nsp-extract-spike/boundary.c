/* Bounded pull API. No upstream CLI main, auto key search, extraction paths,
 * stdout/stderr, network calls or persistent key files are reachable here.
 * Return codes: 0 OK; -1 state/input; -2 format/bounds; -3 crypto/integrity;
 * -4 unsupported; -5 I/O. Negative failures never include user input.
 */
#include <stdint.h>
#include <limits.h>
#include "nca.h"
#include "pki.h"
#include "extkeys.h"
#include "sha.h"
#include "rsa.h"
#define META_LIMIT (16u * 1024u * 1024u)
#define CHUNK_LIMIT (64u * 1024u)
static hactool_ctx_t tool;
static nca_ctx_t nca;
static nca_section_ctx_t *section;
static FILE *raw;
static uint64_t extent, pfs_offset;
static pfs0_header_t *directory;
static size_t directory_size;
static int keys_ready;
extern void nsp_clear_parser(void);
void nsp_zero(void *ptr, size_t size) {
    volatile unsigned char *p = ptr;
    while (size--)
        *p++ = 0;
}
void *nsp_resize_keys(void *ptr, size_t old_size, size_t new_size) {
    void *next = calloc(1, new_size);
    if (!next)
        return NULL;
    if (ptr) {
        memcpy(next, ptr, old_size);
        nsp_zero(ptr, old_size);
        free(ptr);
    }
    return next;
}
static int within(uint64_t at, uint64_t len, uint64_t size) {
    return at <= size && len <= size - at;
}
static uint64_t pair(uint32_t lo, uint32_t hi) { return ((uint64_t)hi << 32) | lo; }
void nsp_close(void) {
    if (directory) {
        free(directory);
        directory = NULL;
    }
    directory_size = 0;
    if (section && section->aes)
        free_aes_ctx(section->aes);
    if (nca.file)
        fclose(nca.file);
    if (raw)
        fclose(raw);
    nsp_zero(&nca, sizeof nca);
    section = NULL;
    raw = NULL;
    extent = 0;
    pfs_offset = 0;
}
void nsp_reset(void) {
    nsp_close();
    if (tool.settings.known_titlekeys.titlekeys) {
        nsp_zero(tool.settings.known_titlekeys.titlekeys,
                 tool.settings.known_titlekeys.count * sizeof(titlekey_entry_t));
        free(tool.settings.known_titlekeys.titlekeys);
    }
    nsp_zero(&tool, sizeof tool);
    nsp_clear_parser();
    keys_ready = 0;
}
int nsp_load_keys(void) {
    nsp_reset();
    FILE *prod = fopen("/secret/prod.keys", "rb"), *title = fopen("/secret/title.keys", "rb");
    if (!prod || !title) {
        if (prod)
            fclose(prod);
        if (title)
            fclose(title);
        return -5;
    }
    /* Avoid retaining additional key-file copies in libc read buffers. */
    setvbuf(prod, NULL, _IONBF, 0);
    setvbuf(title, NULL, _IONBF, 0);
    tool.settings.skip_key_warnings = 1;
    tool.settings.suppress_keydata_output = 1;
    pki_initialize_keyset(&tool.settings.keyset, KEYSET_RETAIL);
    extkeys_initialize_settings(&tool.settings, prod);
    fclose(prod);
    extkeys_parse_titlekeys(&tool.settings, title);
    fclose(title);
    nsp_clear_parser();
    pki_derive_keys(&tool.settings.keyset);
    keys_ready = 1;
    return 0;
}
static int read_at(uint64_t offset, void *out, size_t size) {
    if (!within(offset, size, extent))
        return -2;
    if (section) {
        nca_section_fseek(section, offset);
        return nca_section_fread(section, out, size) == size ? 0 : -5;
    }
    if (!raw || fseeko(raw, (off_t)offset, SEEK_SET))
        return -5;
    return fread(out, 1, size, raw) == size ? 0 : -5;
}
static int load_directory(void) {
    pfs0_header_t head;
    if (read_at(pfs_offset, &head, sizeof head))
        return -5;
    if (head.magic != MAGIC_PFS0 || head.num_files > 100000)
        return -2;
    uint64_t bytes =
        sizeof head + (uint64_t)head.num_files * sizeof(pfs0_file_entry_t) + head.string_table_size;
    if (bytes > META_LIMIT || !within(pfs_offset, bytes, extent))
        return -2;
    directory = malloc((size_t)bytes);
    if (!directory)
        return -1;
    directory_size = (size_t)bytes;
    if (read_at(pfs_offset, directory, directory_size))
        return -5;
    if (memcmp(directory, &head, sizeof head))
        return -2;
    char *strings = pfs0_get_string_table(directory);
    for (uint32_t i = 0; i < head.num_files; i++) {
        pfs0_file_entry_t *e = pfs0_get_file_entry(directory, i);
        if (e->string_table_offset >= head.string_table_size)
            return -2;
        const char *name = strings + e->string_table_offset;
        const char *end = memchr(name, 0, head.string_table_size - e->string_table_offset);
        if (!end || end == name || !strcmp(name, ".") || !strcmp(name, ".."))
            return -2;
        for (const char *p = name; p < end; p++)
            if ((unsigned char)*p < 32 || *p == '/' || *p == '\\' || *p == ':')
                return -2;
        if (!within(pfs_offset + bytes, e->offset, extent) ||
            !within(pfs_offset + bytes + e->offset, e->size, extent))
            return -2;
        /* Quadratic comparisons deliberately avoided: caller catalog performs
         * cross-entry duplicate/overlap policy. Reads remain independently bounded. */
    }
    return 0;
}
int nsp_open_pfs0(const char *path) {
    nsp_close();
    raw = fopen(path, "rb");
    if (!raw)
        return -5;
    if (fseeko(raw, 0, SEEK_END))
        return -5;
    off_t end = ftello(raw);
    if (end < 0)
        return -5;
    extent = (uint64_t)end;
    int result = load_directory();
    if (result)
        nsp_close();
    return result;
}
static int open_header(const char *path) {
    nsp_close();
    if (!keys_ready)
        return -1;
    nca.tool_ctx = &tool;
    nca.file = fopen(path, "rb");
    if (!nca.file)
        return -5;
    if (fseeko(nca.file, 0, SEEK_END))
        return -5;
    off_t end = ftello(nca.file);
    if (end < 0xC00)
        return -2;
    extent = (uint64_t)end;
    if (!nca_decrypt_header(&nca))
        return -3;
    if (nca.header.magic != MAGIC_NCA3 && nca.header.magic != MAGIC_NCA2)
        return -4;
    if (nca.header.nca_size != extent || nca.header.kaek_ind >= 3)
        return -2;
    unsigned gen = nca.header.crypto_type > nca.header.crypto_type2 ? nca.header.crypto_type
                                                                    : nca.header.crypto_type2;
    if (gen)
        gen--;
    if (gen >= 32)
        return -4;
    nca.crypto_type = (unsigned char)gen;
    for (unsigned i = 0; i < 16; i++)
        if (nca.header.rights_id[i])
            nca.has_rights_id = 1;
    return 0;
}
/* Public fields only, 24 bytes: u64 title ID, u64 size, u32 content type,
 * u32 fixed-signature-valid. Header inspection is NOT content authentication. */
int nsp_inspect_nca(const char *path, unsigned char *out) {
    int rc = open_header(path);
    if (rc)
        return rc;
    uint32_t type = nca.header.content_type, valid = 0;
    if (nca.header.fixed_key_generation < 2)
        valid = rsa2048_pss_verify(
                    &nca.header.magic, 0x200, nca.header.fixed_key_sig,
                    tool.settings.keyset.nca_hdr_fixed_key_moduli[nca.header.fixed_key_generation])
                    ? 1
                    : 0;
    memcpy(out, &nca.header.title_id, 8);
    memcpy(out + 8, &nca.header.nca_size, 8);
    memcpy(out + 16, &type, 4);
    memcpy(out + 20, &valid, 4);
    return 0;
}
/* Meta NCA only: authenticated header, PFS0 SHA256 hierarchy, CTR/none.
 * No Program RomFS/BKTR activation until separately fixture-tested. */
int nsp_open_meta(const char *path) {
    unsigned char public_info[24];
    int rc = nsp_inspect_nca(path, public_info);
    if (rc)
        return rc;
    uint32_t valid;
    memcpy(&valid, public_info + 20, 4);
    if (!valid)
        return -3;
    if (nca.header.content_type != NCACONTENTTYPE_META)
        return -4;
    if (!nca.has_rights_id)
        nca_decrypt_key_area(&nca);
    unsigned found = 4;
    for (unsigned i = 0; i < 4; i++)
        if (nca.header.section_entries[i].media_start_offset) {
            if (found != 4)
                return -4;
            found = i;
        }
    if (found == 4)
        return -2;
    nca_fs_header_t *h = &nca.header.fs_headers[found];
    if (h->partition_type != PARTITION_PFS0 || h->fs_type != FS_TYPE_PFS0 ||
        (h->crypt_type != CRYPT_CTR && h->crypt_type != CRYPT_NONE))
        return -4;
    unsigned char digest[32];
    sha256_hash_buffer(digest, h, sizeof *h);
    if (memcmp(digest, nca.header.section_hashes[found], 32))
        return -3;
    uint64_t start = (uint64_t)nca.header.section_entries[found].media_start_offset * 512;
    uint64_t end = (uint64_t)nca.header.section_entries[found].media_end_offset * 512;
    if (start < 0xC00 || end < start || end > extent)
        return -2;
    section = &nca.section_contexts[found];
    section->file = nca.file;
    section->tool_ctx = &tool;
    section->offset = start;
    section->size = end - start;
    section->header = h;
    section->crypt_type = h->crypt_type;
    section->is_decrypted = nca.is_decrypted || h->crypt_type == CRYPT_NONE;
    for (unsigned j = 0; j < 8; j++)
        section->ctr[j] = h->section_ctr[7 - j];
    if (!section->is_decrypted) {
        unsigned char key[16];
        if (nca.has_rights_id) {
            titlekey_entry_t *entry = settings_get_titlekey(&tool.settings, nca.header.rights_id);
            if (!entry)
                return -3;
            aes_ctx_t *aes =
                new_aes_ctx(tool.settings.keyset.titlekeks[nca.crypto_type], 16, AES_MODE_ECB);
            aes_decrypt(aes, key, entry->titlekey, 16);
            free_aes_ctx(aes);
        } else
            memcpy(key, nca.decrypted_keys[2], 16);
        section->aes = new_aes_ctx(key, 16, AES_MODE_CTR);
        nsp_zero(key, sizeof key);
    }
    extent = section->size;
    pfs0_superblock_t *sb = &h->pfs0_superblock;
    if (sb->pfs0_size > META_LIMIT || sb->hash_table_size > META_LIMIT || !sb->block_size ||
        sb->block_size > META_LIMIT ||
        !within(sb->hash_table_offset, sb->hash_table_size, extent) ||
        !within(sb->pfs0_offset, sb->pfs0_size, extent))
        return -2;
    uint64_t blocks = (sb->pfs0_size + sb->block_size - 1) / sb->block_size;
    if (blocks * 32 > sb->hash_table_size)
        return -2;
    unsigned char *hashes = malloc((size_t)sb->hash_table_size), *block = malloc(sb->block_size);
    if (!hashes || !block) {
        free(hashes);
        free(block);
        return -1;
    }
    rc = read_at(sb->hash_table_offset, hashes, (size_t)sb->hash_table_size);
    if (!rc) {
        sha256_hash_buffer(digest, hashes, (size_t)sb->hash_table_size);
        if (memcmp(digest, sb->master_hash, 32))
            rc = -3;
    }
    for (uint64_t i = 0; !rc && i < blocks; i++) {
        size_t bytes = sb->block_size;
        if (bytes > sb->pfs0_size - i * sb->block_size)
            bytes = (size_t)(sb->pfs0_size - i * sb->block_size);
        rc = read_at(sb->pfs0_offset + i * sb->block_size, block, bytes);
        if (!rc) {
            sha256_hash_buffer(digest, block, bytes);
            if (memcmp(digest, hashes + i * 32, 32))
                rc = -3;
        }
    }
    free(hashes);
    free(block);
    if (rc)
        return rc;
    /* Restrict directory reads and members to the verified PFS0 region. */
    pfs_offset = sb->pfs0_offset;
    extent = pfs_offset + sb->pfs0_size;
    rc = load_directory();
    if (rc)
        nsp_close();
    return rc;
}
int nsp_entry_count(void) { return directory ? (int)directory->num_files : -1; }
int nsp_entry_info(uint32_t index, unsigned char *out, uint32_t capacity) {
    if (!directory || index >= directory->num_files || capacity < 17)
        return -1;
    pfs0_file_entry_t *e = pfs0_get_file_entry(directory, index);
    const char *name = pfs0_get_file_name(directory, index);
    size_t len = strlen(name) + 1;
    if (len > capacity - 16)
        return -2;
    memcpy(out, &e->offset, 8);
    memcpy(out + 8, &e->size, 8);
    memcpy(out + 16, name, len);
    return (int)(16 + len);
}
int nsp_read_entry(uint32_t index, uint32_t lo, uint32_t hi, unsigned char *out, uint32_t count) {
    if (!directory || index >= directory->num_files || count > CHUNK_LIMIT)
        return -1;
    pfs0_file_entry_t *e = pfs0_get_file_entry(directory, index);
    uint64_t offset = pair(lo, hi);
    if (!within(offset, count, e->size))
        return -2;
    int rc = read_at(pfs_offset + directory_size + e->offset + offset, out, count);
    return rc ? rc : (int)count;
}
int nsp_crypto_fixture(void);
