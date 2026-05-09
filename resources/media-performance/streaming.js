/**
 * Media Source Extensions (MSE) playback benchmark.
 * Simulates a video streaming user journey: prefetching video chunks,
 * initializing a MediaSource, loading video data, beginning playback,
 * measuring paint latency (via requestVideoFrameCallback), and seeking.
 */
(function () {
    const video = document.getElementById("player");
    const statusEl = document.getElementById("status");

    const VIDEO_URL = "bigbuckbunny.mp4";
    const VIDEO_MIME = 'video/mp4; codecs="avc1.42E01E"';
    const SEEK_DELTA_SECONDS = 1.5;

    const session = {
        buffer: null,
        sourceUrl: null,
        loaded: false,
    };

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function markCompleted(buttonId) {
        document.getElementById(buttonId).classList.add("completed");
    }

    function waitForPaintedFrame() {
        return new Promise((resolve, reject) => {
            if (typeof video.requestVideoFrameCallback !== "function") {
                reject(new Error("requestVideoFrameCallback not supported"));
                return;
            }
            video.requestVideoFrameCallback(() => resolve());
        });
    }

    async function ensurePrefetched() {
        if (session.buffer)
            return;
        const response = await fetch(VIDEO_URL);
        if (!response.ok)
            throw new Error(`Fetch failed with status: ${response.status}`);

        session.buffer = await response.arrayBuffer();
    }

    window.prefetchVideo = function () {
        ensurePrefetched().finally(() => {
            document.body.dataset.prefetchReady = "1";
        });
    };

    function waitForSourceOpen(mediaSource) {
        if (mediaSource.readyState === "open")
            return Promise.resolve();
        return new Promise((resolve) => {
            mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
        });
    }

    function appendBufferAsync(sourceBuffer, buffer) {
        return new Promise((resolve, reject) => {
            const onAppendError = () => {
                sourceBuffer.removeEventListener("updateend", onUpdateEnd);
                reject(new Error("SourceBuffer append error"));
            };
            const onUpdateEnd = () => {
                sourceBuffer.removeEventListener("error", onAppendError);
                resolve();
            };
            sourceBuffer.addEventListener("error", onAppendError, { once: true });
            sourceBuffer.addEventListener("updateend", onUpdateEnd, { once: true });
            sourceBuffer.appendBuffer(buffer);
        });
    }

    async function initialPlayback() {
        try {
            const MediaSourceAPI = window.ManagedMediaSource || window.MediaSource;
            if (typeof MediaSourceAPI !== "function" || !MediaSourceAPI.isTypeSupported(VIDEO_MIME))
                throw new Error(`MediaSource or MIME type ${VIDEO_MIME} not supported`);

            video.muted = true;

            const mediaSource = new MediaSourceAPI();
            session.sourceUrl = URL.createObjectURL(mediaSource);
            video.src = session.sourceUrl;

            await ensurePrefetched();
            await waitForSourceOpen(mediaSource);

            const sourceBuffer = mediaSource.addSourceBuffer(VIDEO_MIME);
            await appendBufferAsync(sourceBuffer, session.buffer);

            if (mediaSource.readyState === "open")
                mediaSource.endOfStream();

            session.loaded = true;
            await video.play();
            await waitForPaintedFrame();
            setStatus(`Loaded (duration=${video.duration.toFixed(2)}s)`);
            markCompleted("initial-playback");
        } catch (e) {
            setStatus(`Playback failed: ${e.message}`);
            throw e;
        }
    }

    function waitForSeeked() {
        return new Promise((resolve, reject) => {
            video.addEventListener("seeked", () => resolve(), { once: true });
            video.addEventListener("error", () => reject(new Error("Video error during seek")), { once: true });
        });
    }

    async function seek() {
        try {
            if (!session.loaded || !isFinite(video.duration)) {
                setStatus("Seek skipped (not loaded)");
                markCompleted("seek");
                return;
            }
            const target = Math.min(video.currentTime + SEEK_DELTA_SECONDS, Math.max(0, video.duration - 0.1));
            const seeked = waitForSeeked();
            video.currentTime = target;
            await seeked;
            await waitForPaintedFrame();
            setStatus(`Seeked to ${video.currentTime.toFixed(2)}s`);
            markCompleted("seek");
        } catch (e) {
            setStatus(`Seek failed: ${e.message}`);
            throw e;
        }
    }

    document.getElementById("initial-playback").addEventListener("click", initialPlayback);
    document.getElementById("seek").addEventListener("click", seek);
})();
