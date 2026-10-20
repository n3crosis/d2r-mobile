#!/usr/bin/env python3
"""Small fail-closed transformations against one pinned upstream revision."""

from pathlib import Path
import sys

root = Path(sys.argv[1])
p = root / "extkeys.c"
s = p.read_text()


def replace_once(old, new):
    global s
    if s.count(old) != 1:
        raise SystemExit("Pinned upstream source mismatch")
    s = s.replace(old, new)


replace_once(
    "static int get_kv(FILE *f, char **key, char **value) {",
    """#define NSP_KEY_LINE_BYTES 4096
static char nsp_parser_line[NSP_KEY_LINE_BYTES + 3]; /* content + CRLF + NUL */
void nsp_clear_parser(void) { nsp_zero(nsp_parser_line, sizeof nsp_parser_line); }
static int get_kv(FILE *f, char **key, char **value) {""",
)
replace_once(
    "    static char line[1024];", "    char *line = nsp_parser_line;\n    nsp_clear_parser();"
)
replace_once("fgets(line, (int)sizeof(line), f)", "fgets(line, (int)sizeof(nsp_parser_line), f)")
replace_once(
    "    if (errno != 0)\n        return -2;",
    """    if (errno != 0)
        return -2;

    /* Keep one physical line per parser call. RSA-sized dump entries may be
     * unrecognized by hactool, but must never split into a second key record.
     * Match the bounded JS validator, reserving room for CRLF and the NUL. */
    size_t line_length = strlen(line), content_length = line_length;
    if (content_length && line[content_length - 1] == '\\n')
        content_length--;
    if (content_length && line[content_length - 1] == '\\r')
        content_length--;
    if (content_length > NSP_KEY_LINE_BYTES) {
        if (!line_length || line[line_length - 1] != '\\n') {
            int next;
            do { next = fgetc(f); } while (next != '\\n' && next != EOF);
        }
        nsp_clear_parser();
        return ferror(f) ? -2 : -1;
    }""",
)
replace_once(
    "realloc(settings->known_titlekeys.titlekeys, 2 * (settings->known_titlekeys.count + 1) * sizeof(titlekey_entry_t))",
    "nsp_resize_keys(settings->known_titlekeys.titlekeys, settings->known_titlekeys.count * sizeof(titlekey_entry_t), 2 * (settings->known_titlekeys.count + 1) * sizeof(titlekey_entry_t))",
)
replace_once(
    "                settings_add_titlekey(settings, rights_id, titlekey);",
    "                settings_add_titlekey(settings, rights_id, titlekey);\n                nsp_zero(titlekey, sizeof titlekey);",
)
p.write_text(s)
# Upstream maps its 64-bit name to fseek; long is 32-bit on wasm32. Use off_t.
p = root / "utils.h"
s = p.read_text()
old = "#define fseeko64 fseek"
if s.count(old) != 1:
    raise SystemExit("Pinned upstream seek shim mismatch")
p.write_text(s.replace(old, "#define fseeko64 fseeko"))
