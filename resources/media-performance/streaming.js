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
    // We choose a value which is intentionally not on a key-frame, but several frames after one.
    // This ensures that the seek requires decoding a sequence of inter-frames (P-frames),
    // rather than just jumping to a key-frame, which measures more realistic decoding latency.
    // In bigbuckbunny.mp4, key-frames are at 0.00s and 8.33s. 1.6s is 48 frames after the
    // first key-frame (at 30fps), forcing the decoder to process all preceding P-frames.
    const SEEK_DELTA_SECONDS = 1.5;

    const session = {
        buffer: null,
        sourceUrl: null,
        loaded: false,
        mediaSource: null,
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
            video.requestVideoFrameCallback((now, metadata) => {
                // rVFC can fire 1 VSYNC before the frame is actually on screen.
                // Wait until expectedDisplayTime so we measure when the frame is painted, not when the callback fires.
                const delay = metadata.expectedDisplayTime - now;
                if (delay > 0)
                    setTimeout(resolve, delay);
                else
                    resolve();
            });
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

    window.prefetchVideo = async function () {
        await ensurePrefetched();
        if (session.mediaSource && session.mediaSource.readyState === "open")
            return;

        const MediaSourceAPI = window.ManagedMediaSource || window.MediaSource;
        if (typeof MediaSourceAPI !== "function" || !MediaSourceAPI.isTypeSupported(VIDEO_MIME))
            throw new Error(`MediaSource or MIME type ${VIDEO_MIME} not supported`);

        session.mediaSource = new MediaSourceAPI();
        session.sourceUrl = URL.createObjectURL(session.mediaSource);
        video.src = session.sourceUrl;

        await waitForSourceOpen(session.mediaSource);
        document.body.dataset.prefetchReady = "1";
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
            // Enforce that prefetch MUST be completed beforehand.
            // Do not automatically call window.prefetchVideo() here, because that pollutes the timeline.
            if (!session.loaded && (!session.mediaSource || session.mediaSource.readyState !== "open" || !session.buffer))
                throw new Error("Benchmark error: Prefetch step must complete before starting initial playback.");

            // Step 1: Add SourceBuffer and append video data.
            const sourceBuffer = session.mediaSource.addSourceBuffer(VIDEO_MIME);
            await appendBufferAsync(sourceBuffer, session.buffer);

            if (session.mediaSource.readyState === "open")
                session.mediaSource.endOfStream();

            session.loaded = true;

            // Step 2: Start playback and wait for the first painted frame.
            const painted = waitForPaintedFrame();
            await video.play();
            await painted;
            setStatus(`Loaded (duration=${video.duration.toFixed(2)}s)`);
            markCompleted("initial-playback");
        } catch (e) {
            setStatus(`Playback failed: ${e.message}`);
            throw e;
        }
    }

    function waitForSeeked(targetTime, tolerance = 0.5) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                video.removeEventListener("seeked", handleSeeked);
                video.removeEventListener("error", handleError);
            };

            const handleSeeked = () => {
                const diff = Math.abs(video.currentTime - targetTime);

                if (diff <= tolerance) {
                    cleanup();
                    resolve();
                } else {
                    cleanup();
                    reject(new Error(`Seek target mismatch. Expected ~${targetTime}s, but got ${video.currentTime}s`));
                }
            };

            const handleError = () => {
                cleanup();
                reject(new Error("Video error during seek"));
            };

            video.addEventListener("seeked", handleSeeked);
            video.addEventListener("error", handleError);
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
            const seeked = waitForSeeked(target);
            const painted = waitForPaintedFrame();
            video.currentTime = target;
            await seeked;
            await painted;
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
