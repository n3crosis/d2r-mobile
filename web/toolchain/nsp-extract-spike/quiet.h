#ifndef NSP_QUIET_H
#define NSP_QUIET_H
/* Compile upstream diagnostics out BEFORE formatting key-derived arguments. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define printf(...) ((int)0)
#define fprintf(...) ((int)0)
void nsp_zero(void *ptr, size_t size);
void *nsp_resize_keys(void *ptr, size_t old_size, size_t new_size);
#endif
