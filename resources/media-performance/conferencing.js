/* eslint-disable no-empty */
/* global VideoDecoder, VideoEncoder, AudioDecoder, AudioEncoder, VideoFrame, AudioData */
/**
 * WebCodecs and WebAudio performance benchmark.
 * Simulates a video/audio conferencing session (video chat and voice chat).
 * Measures the performance of encoding/decoding video frames with WebCodecs,
 * rendering them on local and remote HTML5 Canvases, and processing audio
 * round trips via WebCodecs and Web Audio offline graph rendering.
 */
(function () {
    const localCanvas = document.getElementById("local-canvas");
    const remoteCanvas = document.getElementById("remote-canvas");
    const localCtx = localCanvas.getContext("2d");
    const remoteCtx = remoteCanvas.getContext("2d");
    const statusEl = document.getElementById("status");

    const FRAME_WIDTH = 1920;
    const FRAME_HEIGHT = 1080;
    const VIDEO_FRAME_COUNT = 10;
    const AUDIO_FRAME_COUNT = 100;
    const AUDIO_SAMPLE_RATE = 48000;
    const AUDIO_FRAME_SIZE = 1024;
    const AUDIO_OFFLINE_DURATION_SECONDS = 30;
    const AUDIO_TONE_HZ = 440;

    const WEBAUDIO_SAMPLE_COUNT = AUDIO_SAMPLE_RATE * AUDIO_OFFLINE_DURATION_SECONDS;

    // Pre-generate the audio samples before we start the timer.
    const PRE_GENERATED_AUDIO_SAMPLES = (function () {
        const data = new Float32Array(WEBAUDIO_SAMPLE_COUNT);
        const omega = (2 * Math.PI * AUDIO_TONE_HZ) / AUDIO_SAMPLE_RATE;
        for (let i = 0; i < WEBAUDIO_SAMPLE_COUNT; i++)
            data[i] = Math.sin(omega * i);
        return data;
    })();

    const VIDEO_CODEC = "vp09.00.10.08";

    const webCodecsSupported
        = typeof globalThis.VideoEncoder === "function"
        && typeof globalThis.VideoDecoder === "function"
        && typeof globalThis.AudioEncoder === "function"
        && typeof globalThis.AudioDecoder === "function"
        && typeof globalThis.VideoFrame === "function"
        && typeof globalThis.AudioData === "function";

    const session = {
        videoEncoder: null,
        videoDecoder: null,
        audioEncoder: null,
        audioDecoder: null,
        codec: null,
        framesDecoded: 0,
    };

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function markCompleted(buttonId) {
        const el = document.getElementById(buttonId);
        if (el)
            el.classList.add("completed");
    }

    /**
     * Renders a solid background, a moving colored box to simulate motion, and text showing the current frame index.
     */
    function drawLocalFrame(i) {
        localCtx.fillStyle = "#1e1e1e";
        localCtx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

        const boxSize = 200;
        const x = (i * 15) % (FRAME_WIDTH - boxSize);
        const y = Math.abs(Math.sin(i * 0.1)) * (FRAME_HEIGHT - boxSize);

        const hue = (i * 2) % 360;
        localCtx.fillStyle = `hsl(${hue}, 80%, 60%)`;
        localCtx.fillRect(x, y, boxSize, boxSize);

        localCtx.fillStyle = "#ffffff";
        localCtx.font = "40px sans-serif";
        localCtx.fillText(`Frame ${i}`, 20, 50);
    }

    async function initializeVideoSession() {
        if (!webCodecsSupported)
            throw new Error("WebCodecs not supported");

        try {
            const support = await VideoEncoder.isConfigSupported({
                codec: VIDEO_CODEC,
                width: FRAME_WIDTH,
                height: FRAME_HEIGHT,
                bitrate: 1_000_000,
                framerate: 30,
            });
            if (!support || !support.supported)
                throw new Error(`Video codec ${VIDEO_CODEC} not supported`);

            session.videoDecoder = new VideoDecoder({
                output(frame) {
                    remoteCtx.drawImage(frame, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
                    frame.close();
                    session.framesDecoded++;
                },
                error(e) {
                    throw e;
                },
            });

            session.videoEncoder = new VideoEncoder({
                output(chunk, metadata) {
                    if (metadata && metadata.decoderConfig && session.videoDecoder.state !== "configured")
                        session.videoDecoder.configure(metadata.decoderConfig);
                    if (session.videoDecoder.state === "configured")
                        session.videoDecoder.decode(chunk);
                },
                error(e) {
                    throw e;
                },
            });

            session.videoEncoder.configure({
                codec: VIDEO_CODEC,
                width: FRAME_WIDTH,
                height: FRAME_HEIGHT,
                bitrate: 1_000_000,
                framerate: 30,
            });

            setStatus(`Video session joined (codec=${VIDEO_CODEC})`);
        } catch (e) {
            setStatus(`Video codec init failed: ${e.message}`);
            throw e;
        }
    }

    async function initializeAudioSession() {
        if (!webCodecsSupported)
            throw new Error("WebCodecs not supported");

        try {
            session.audioDecoder = new AudioDecoder({
                output(data) {
                    data.close();
                },
                error(e) {
                    throw e;
                },
            });

            session.audioEncoder = new AudioEncoder({
                output(chunk, metadata) {
                    if (!session.audioDecoder)
                        return;
                    if (metadata && metadata.decoderConfig && session.audioDecoder.state !== "configured")
                        session.audioDecoder.configure(metadata.decoderConfig);
                    if (session.audioDecoder.state === "configured")
                        session.audioDecoder.decode(chunk);
                },
                error(e) {
                    throw e;
                },
            });

            session.audioEncoder.configure({
                codec: "opus",
                sampleRate: AUDIO_SAMPLE_RATE,
                numberOfChannels: 1,
                bitrate: 96_000,
            });

            setStatus("Audio session joined");
        } catch (e) {
            setStatus(`Audio codec init failed: ${e.message}`);
            throw e;
        }
    }

    async function simulateVideoCall() {
        if (!session.videoEncoder)
            throw new Error("VideoEncoder not initialized");
        for (let i = 0; i <= VIDEO_FRAME_COUNT; i++) {
            drawLocalFrame(i);

            const frame = new VideoFrame(localCanvas, { timestamp: i * 33333 });
            session.videoEncoder.encode(frame);
            frame.close();
        }

        await session.videoEncoder.flush();
        await session.videoDecoder.flush();

        setStatus(`Frames decoded: ${session.framesDecoded}`);
    }

    async function simulateVoiceCall() {
        if (!session.audioEncoder)
            return;
        const audioBuffer = PRE_GENERATED_AUDIO_SAMPLES.subarray(0, AUDIO_FRAME_SIZE);
        const frameDurationUs = (AUDIO_FRAME_SIZE * 1_000_000) / AUDIO_SAMPLE_RATE;
        for (let i = 0; i < AUDIO_FRAME_COUNT; i++) {
            const audioData = new AudioData({
                format: "f32",
                sampleRate: AUDIO_SAMPLE_RATE,
                numberOfFrames: AUDIO_FRAME_SIZE,
                numberOfChannels: 1,
                timestamp: i * frameDurationUs,
                data: audioBuffer,
            });
            session.audioEncoder.encode(audioData);
            audioData.close();
        }
        await session.audioEncoder.flush();
        await session.audioDecoder.flush();
    }

    /**
     * Benchmarks Web Audio rendering capability.
     * Creates an OfflineAudioContext, builds an audio graph with a buffer source (sine wave),
     * a highpass biquad filter, and a gain node, then renders the audio offline.
     */
    async function simulateAudioEffects() {
        const length = AUDIO_SAMPLE_RATE * AUDIO_OFFLINE_DURATION_SECONDS;
        const offline = new OfflineAudioContext(1, length, AUDIO_SAMPLE_RATE);
        const buffer = offline.createBuffer(1, length, AUDIO_SAMPLE_RATE);
        const channel = buffer.getChannelData(0);
        channel.set(PRE_GENERATED_AUDIO_SAMPLES);

        const source = offline.createBufferSource();
        source.buffer = buffer;

        const highpass = offline.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 100;

        const gain = offline.createGain();
        gain.gain.value = 0.8;

        source.connect(highpass).connect(gain).connect(offline.destination);
        source.start(0);
        await offline.startRendering();
    }

    function teardownSession() {
        session.videoEncoder?.close();
        session.videoDecoder?.close();
        session.audioEncoder?.close();
        session.audioDecoder?.close();
        session.videoEncoder = null;
        session.videoDecoder = null;
        session.audioEncoder = null;
        session.audioDecoder = null;

        localCtx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        remoteCtx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

        setStatus("Left call");
    }

    async function runVideoBenchmark() {
        try {
            await initializeVideoSession();
            await simulateVideoCall();
            teardownSession();
            markCompleted("video-benchmark");
        } catch (e) {
            setStatus(`VideoChat failed: ${e.message}`);
            throw e;
        }
    }

    async function runVoiceBenchmark() {
        try {
            await initializeAudioSession();
            // WebCodecs
            await simulateVoiceCall();
            // WebAudio
            await simulateAudioEffects();
            setStatus("Audio processed");
            teardownSession();
            markCompleted("voice-benchmark");
        } catch (e) {
            setStatus(`VoiceChat failed: ${e.message}`);
            throw e;
        }
    }

    document.getElementById("video-benchmark").addEventListener("click", runVideoBenchmark);
    document.getElementById("voice-benchmark").addEventListener("click", runVoiceBenchmark);
})();
