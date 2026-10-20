# Completed IPA download preparation

中文: [DOWNLOAD_PREPARATION.zh-CN.md](DOWNLOAD_PREPARATION.zh-CN.md)

A successful conversion and its resource/Legacy Device Pack exports stay complete
even if the browser cannot create the IPA's object URL. The UI retains the
successful Blob and filename, reports a separate download-preparation warning,
and offers a retry button that only prepares the link. It never reruns conversion
or export. Raw browser error messages are not shown.

`createDownloadPreparation()` owns the retained Blob and prepared URL. `retain`
accepts a completed output, `prepare` reports `ready`, `retryable` or `unavailable`,
and `dispose` drops references and revokes the current URL. Repeated preparation
of the same output reuses its existing URL. Replacement revokes the old URL only
after the new one exists. Unmount disposes the retained output. No file/network
access or persistent storage is added.

Automatic clicking is a convenience only: node creation, append, click and removal
failures are contained by `attemptAutomaticDownload`; the visible successful URL
remains available. The UI's completed-generation branch is separated from the
conversion-failure report path, so a preparation failure cannot relabel a completed
Legacy Device Pack as incomplete or claim that no IPA was generated.

`node --test web/tests/download-preparation.test.mjs` checks retained-Blob retry,
URL replacement/reuse/disposal, automatic-click failure and UI source contracts.
Synthetic URL/DOM doubles do not replace real browser download testing.
