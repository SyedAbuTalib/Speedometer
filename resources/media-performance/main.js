(function () {
    const videoPipelineTrigger = document.getElementById('video-pipeline-trigger');
    const audioPipelineTrigger = document.getElementById('audio-pipeline-trigger');

    // Generates sine waves to encode and immediately decode
    async function runTranscodeAudioPipelineTest() {
        if (!('AudioEncoder' in window) || !('AudioDecoder' in window)) {
            console.error('Web Codecs API not supported');
            return;
        }

        try {
            const sampleRate = 48000;
            const numberOfChannels = 1;
            const frameCount = 1024;
            const iterations = 3000;

            let encodedChunksCount = 0;
            let decodedFramesCount = 0;

            // Setup the Opus decoder to count decoded frames
            const decoder = new AudioDecoder({
                output(data) {
                    decodedFramesCount++;
                    data.close();
                    if (decodedFramesCount >= iterations) {
                        audioPipelineTrigger.classList.add('completed');
                    }
                },
                error(e) {
                    console.error('Decoder Error:', e);
                }
            });

            decoder.configure({
                codec: 'opus',
                sampleRate: sampleRate,
                numberOfChannels: numberOfChannels
            });

            // immediately decode the generated chunks
            const encoder = new AudioEncoder({
                output(chunk, metadata) {
                    encodedChunksCount++;
                    decoder.decode(chunk);

                    if (encodedChunksCount === iterations) {
                        decoder.flush();
                    }
                },
                error(e) {
                    console.error('Encoder Error:', e);
                }
            });

            encoder.configure({
                codec: 'opus',
                sampleRate: sampleRate,
                numberOfChannels: numberOfChannels,
                bitrate: 128000
            });

            const dataLength = frameCount * numberOfChannels;
            const audioBuffer = new Float32Array(dataLength);
            
            // Fill the buffer
            for (let i = 0; i < dataLength; i++) {
                audioBuffer[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
            }

            for (let i = 0; i < iterations; i++) {
                const audioData = new AudioData({
                    format: 'f32',
                    sampleRate: sampleRate,
                    numberOfFrames: frameCount,
                    numberOfChannels: numberOfChannels,
                    timestamp: i * (frameCount * 1000000 / sampleRate),
                    data: audioBuffer
                });

                encoder.encode(audioData);
                audioData.close();
            }

            encoder.flush();

        } catch (error) {
            console.error('Audio Test Error:', error);
        }
    }

    // Draws frames on a canvas to encode via VP8 and immediately decode
    async function runTranscodeVideoPipelineTest() {
        if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
            console.error('Web Codecs Video API not supported');
            return;
        }

        try {
            const width = 320;
            const height = 240;
            const iterations = 100;

            let encodedChunksCount = 0;
            let decodedFramesCount = 0;

            // Setup the VP8 decoder
            const decoder = new VideoDecoder({
                output(frame) {
                    decodedFramesCount++;
                    frame.close();
                    if (decodedFramesCount >= iterations) {
                        videoPipelineTrigger.classList.add('completed');
                    }
                },
                error(e) {
                    console.error('Video Decoder Error:', e);
                }
            });

            decoder.configure({
                codec: 'vp8',
                codedWidth: width,
                codedHeight: height
            });

            // Setup the VP8 encoder and pass output directly to the decoder
            const encoder = new VideoEncoder({
                output(chunk, metadata) {
                    encodedChunksCount++;
                    decoder.decode(chunk);

                    if (encodedChunksCount === iterations) {
                        decoder.flush();
                    }
                },
                error(e) {
                    console.error('Video Encoder Error:', e);
                }
            });

            encoder.configure({
                codec: 'vp8',
                width: width,
                height: height,
                bitrate: 2000000,
                framerate: 30
            });

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Generate unique frames by rotating colors and timestamping
            for (let i = 0; i < iterations; i++) {
                ctx.fillStyle = `rgb(${(i * 10) % 255}, 100, 200)`;
                ctx.fillRect(0, 0, width, height);

                const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
                encoder.encode(frame);
                frame.close();
            }

            encoder.flush();

        } catch (error) {
            console.error('Video Test Error:', error);
        }
    }

    if (videoPipelineTrigger) {
        videoPipelineTrigger.addEventListener('click', () => {
            runTranscodeVideoPipelineTest();
        });
    }

    if (audioPipelineTrigger) {
        audioPipelineTrigger.addEventListener('click', () => {
            runTranscodeAudioPipelineTest();
        });
    }
})();
