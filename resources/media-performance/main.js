/* global VideoDecoder, VideoEncoder, AudioDecoder, AudioEncoder, VideoFrame, AudioData */
(function () {
    const videoChatTrigger = document.getElementById("video-chat-trigger");
    const videoPlaybackTrigger = document.getElementById("video-playback-trigger");
    const localCanvas = document.getElementById("local-canvas");
    const remoteCanvas = document.getElementById("remote-canvas");
    const video = document.getElementById("video");
    const playbackStatus = document.getElementById("playback-status");
    const playbackDroppedFrames = document.getElementById("playback-dropped-frames");

    // Calibrated to fit Speedometer's 10-30ms execution time budget per step.
    const videoConfig = {
        codec: "vp09.00.10.08",
        width: 640,
        height: 360,
        bitrate: 2000000,
        framerate: 30,
        iterations: 5 
    };

    const audioConfig = {
        codec: "opus",
        sampleRate: 48000,
        numberOfChannels: 1,
        bitrate: 128000,
        iterations: 5,
        frameCount: 1024
    };

    let prefetchedVideoBuffer = null;

    // Exposed to the Speedometer runner's prepare step to avoid measuring network latency
    window.prefetchVideo = async () => {
        try {
            const response = await fetch("bigbuckbunny.webm");
            prefetchedVideoBuffer = await response.arrayBuffer();
        } catch (e) {
            console.error("Prefetch failed:", e);
        }
    };

    function showView(containerId) {
        document.querySelectorAll(".simulation-container").forEach(c => c.classList.remove("active"));
        document.getElementById(containerId).classList.add("active");
    }

    async function runVideoChatSimulation() {
        if (!("VideoEncoder" in window) || !("VideoDecoder" in window)) {
            console.log("WebCodecs not supported");
            return;
        }

        showView("video-chat-container");
        videoChatTrigger.disabled = true;

        const localCtx = localCanvas.getContext("2d");
        const remoteCtx = remoteCanvas.getContext("2d");

        const decoder = new VideoDecoder({
            output(frame) {
                remoteCtx.drawImage(frame, 0, 0, remoteCanvas.width, remoteCanvas.height);
                frame.close();
            },
            error(e) { console.error("Video Decoder Error:", e); }
        });

        decoder.configure({
            codec: videoConfig.codec,
            codedWidth: videoConfig.width,
            codedHeight: videoConfig.height
        });

        const encoder = new VideoEncoder({
            output(chunk, metadata) {
                if (metadata.decoderConfig)
                    decoder.configure(metadata.decoderConfig);
                decoder.decode(chunk);
            },
            error(e) { console.error("Video Encoder Error:", e); }
        });

        encoder.configure(videoConfig);

        const audioDecoder = new AudioDecoder({
            output(data) { data.close(); },
            error(e) { console.error("Audio Decoder Error:", e); }
        });

        audioDecoder.configure({
            codec: audioConfig.codec,
            sampleRate: audioConfig.sampleRate,
            numberOfChannels: audioConfig.numberOfChannels
        });

        const audioEncoder = new AudioEncoder({
            output(chunk, metadata) {
                if (metadata.decoderConfig)
                    audioDecoder.configure(metadata.decoderConfig);
                audioDecoder.decode(chunk);
            },
            error(e) { console.error("Audio Encoder Error:", e); }
        });

        audioEncoder.configure(audioConfig);

        // Simulate Video Processing Loop
        for (let i = 0; i < videoConfig.iterations; i++) {
            localCtx.fillStyle = `hsl(${i % 360}, 70%, 50%)`;
            localCtx.fillRect(0, 0, videoConfig.width, videoConfig.height);
            localCtx.fillStyle = "white";
            localCtx.font = "30px sans-serif";
            localCtx.fillText(`Frame: ${i}`, 20, 50);

            const frame = new VideoFrame(localCanvas, { timestamp: i * 33333 });
            encoder.encode(frame);
            frame.close();
        }
        
        // Wait for all video frames to be encoded and subsequently decoded
        await encoder.flush();
        await decoder.flush();

        // Simulate Audio Processing Loop
        const dataLength = audioConfig.frameCount * audioConfig.numberOfChannels;
        const audioBuffer = new Float32Array(dataLength);
        for (let i = 0; i < dataLength; i++)
            audioBuffer[i] = Math.sin(2 * Math.PI * 440 * i / audioConfig.sampleRate);

        for (let i = 0; i < audioConfig.iterations; i++) {
            const audioData = new AudioData({
                format: "f32",
                sampleRate: audioConfig.sampleRate,
                numberOfFrames: audioConfig.frameCount,
                numberOfChannels: audioConfig.numberOfChannels,
                timestamp: i * (audioConfig.frameCount * 1000000 / audioConfig.sampleRate),
                data: audioBuffer
            });
            audioEncoder.encode(audioData);
            audioData.close();
        }
        
        // Wait for all audio data to be encoded and subsequently decoded
        await audioEncoder.flush();
        await audioDecoder.flush();

        // Web Audio Simulation: Mimics a typical video conferencing audio processing graph
        // Uses OfflineAudioContext to avoid hardware latency and run as fast as possible.
        const offlineCtx = new OfflineAudioContext(
            audioConfig.numberOfChannels,
            audioConfig.sampleRate * 2, // 2 seconds of audio
            audioConfig.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        const buffer = offlineCtx.createBuffer(
            audioConfig.numberOfChannels,
            audioConfig.sampleRate * 2,
            audioConfig.sampleRate
        );

        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < channelData.length; i++)
            channelData[i] = Math.sin(2 * Math.PI * 440 * i / audioConfig.sampleRate);
        source.buffer = buffer;

        const filter = offlineCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 100; // High-pass filter to simulate noise reduction

        const gain = offlineCtx.createGain();
        gain.gain.value = 0.8; // Simulate volume control

        source.connect(filter);
        filter.connect(gain);
        gain.connect(offlineCtx.destination);

        source.start(0);
        
        try {
            await offlineCtx.startRendering();
        } catch (e) {
            console.error("Web Audio error:", e);
        }

        videoChatTrigger.classList.add("completed");
        videoChatTrigger.disabled = false;
    }

    async function runVideoPlaybackSimulation() {
        console.log("Video Playback Simulation starting");
        showView("video-playback-container");
        videoPlaybackTrigger.disabled = true;
        playbackStatus.textContent = "Initializing...";
        playbackDroppedFrames.textContent = "0";

        const mimeCodec = 'video/webm; codecs="vp9"';

        if (!MediaSource.isTypeSupported(mimeCodec)) {
            console.error("MIME type or codec not supported");
            playbackStatus.textContent = "Error: Unsupported Codec";
            videoPlaybackTrigger.disabled = false;
            return;
        }

        const mediaSource = new MediaSource();
        video.src = URL.createObjectURL(mediaSource);

        mediaSource.addEventListener("sourceopen", async () => {
            playbackStatus.textContent = "Buffering...";
            const sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);

            if (prefetchedVideoBuffer) {
                sourceBuffer.appendBuffer(prefetchedVideoBuffer);
            } else {
                console.error("Test failed: Video asset was not prefetched in the prepare step.");
                playbackStatus.textContent = "Error: Asset not preloaded";
                videoPlaybackTrigger.disabled = false;
                return;
            }

            sourceBuffer.addEventListener("updateend", async () => {
                if (!sourceBuffer.updating && mediaSource.readyState === "open")
                    mediaSource.endOfStream();

                playbackStatus.textContent = "Playing...";
                video.play();

                // Wait for playback to progress to ensure pipeline started
                const initialTime = video.currentTime;
                let frameCount = 0;
                while (video.currentTime === initialTime && frameCount < 60) {
                    await new Promise(r => requestAnimationFrame(r));
                    frameCount++;
                }

                if (video.currentTime === initialTime) {
                    console.error("Test failed: Playback did not start within the timeout.");
                    playbackStatus.textContent = "Error: Playback failed";
                    videoPlaybackTrigger.disabled = false;
                    return;
                }

                // Immediately Seek to simulate user interaction without delay
                playbackStatus.textContent = "Seeking...";
                video.currentTime += 1.0;

                await new Promise(r => {
                    video.addEventListener("seeked", () => {
                        if ("requestVideoFrameCallback" in video) {
                            video.requestVideoFrameCallback(() => { r(); });
                        } else {
                            // Fallback for browsers without rVFC
                            requestAnimationFrame(() => { r(); });
                        }
                    }, { once: true });
                });

                playbackStatus.textContent = "Completed";
                videoPlaybackTrigger.classList.add("completed");
                videoPlaybackTrigger.disabled = false;
            }, { once: true });
        });
    }

    videoChatTrigger.addEventListener("click", runVideoChatSimulation);
    videoPlaybackTrigger.addEventListener("click", runVideoPlaybackSimulation);
})();
