// Africa's Talking's <Say> action did text-to-speech for free — Asterisk has
// no TTS engine built in, so the dashboard's editable IVR text needs this
// instead: synthesize with Piper (free, self-hosted, neural — a real step up
// from robotic formant synths like eSpeak) and cache the result keyed by a
// hash of the text. In steady state this plays exactly like a pre-recorded
// file; it only re-synthesizes the moment someone actually edits the
// greeting/menu text in the dashboard.
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPER_BIN = process.env.PIPER_BIN || '/opt/piper/piper/piper';
const DEFAULT_VOICE_MODEL = process.env.PIPER_VOICE_MODEL || '/opt/piper/voices/en_US-lessac-medium.onnx';
// A short key (not a filesystem path) is what callers/the DB pass in — this
// allowlist is the only thing that turns a key into an actual model path,
// so a bad/typo'd value in ivr_config can never point Piper at an arbitrary
// file. Unknown/missing key falls back to DEFAULT_VOICE_MODEL, so existing
// deployments with nothing configured keep working unchanged.
const VOICE_MODELS = {
    lady: process.env.PIPER_VOICE_LADY || DEFAULT_VOICE_MODEL,
    man: process.env.PIPER_VOICE_MAN || DEFAULT_VOICE_MODEL
};
// NOT /var/lib/asterisk/sounds/custom — on this Debian/Ubuntu packaging,
// Asterisk's actual "en/custom/" sound-resolution path is a symlink chain
// (/usr/share/asterisk/sounds/en/custom -> /usr/local/share/asterisk/sounds)
// that points here instead. Files placed in the other directory show up in
// `core show sounds`'s listing (it scans broadly) but fail to actually open
// at playback time ("does not exist in any format") since playback
// resolution follows the language-prefixed symlink, not that directory.
const SOUNDS_DIR = process.env.ASTERISK_CUSTOM_SOUNDS_DIR || '/usr/local/share/asterisk/sounds';

function run(command, args, input) {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, err => (err ? reject(err) : resolve()));
        if (input !== undefined) {
            // If the child fails to start or dies before/during the write
            // (bad binary path, OOM, a crash on certain input text), the
            // stdin stream emits its own 'error' (EPIPE) — a stream event,
            // not something the execFile callback's `err` catches. Left
            // unhandled, that throws and crashes the entire ARI process,
            // dropping every active call on the system, not just this one
            // synthesis request. Rejecting the promise here (safe to call
            // even if the execFile callback also settles it — a promise
            // only honors its first settlement) turns that into a normal,
            // per-call synthesize() failure instead.
            child.stdin.on('error', reject);
            child.stdin.write(input);
            child.stdin.end();
        }
    });
}

// Two calls needing the SAME not-yet-cached text at the same moment (a real
// risk on a single-vCPU box, where synthesis takes seconds) would otherwise
// both spawn Piper against the same temp/output paths — whichever finishes
// first deletes the raw temp file out from under the other, which then
// throws ENOENT and hangs up that caller's channel. This map makes every
// concurrent request for the same hash await the one in-flight synthesis
// instead of racing to produce it twice.
const inFlight = new Map();

// Returns the Asterisk sound name (e.g. "custom/tts-ab12cd34") for the given
// text — the caller passes this straight to channel.play({ media: `sound:${name}` }).
// voiceKey/speedScale are folded into the cache key — otherwise switching
// voice or speed for already-synthesized text would silently keep serving
// the old cached audio, since the hash used to be text-only.
async function synthesize(text, { voiceKey, speedScale = 1.0 } = {}) {
    const voiceModel = VOICE_MODELS[voiceKey] || DEFAULT_VOICE_MODEL;
    const hash = crypto
        .createHash('sha256')
        .update(`${voiceKey || 'default'}|${speedScale}|${text}`)
        .digest('hex')
        .slice(0, 16);
    const soundName = `custom/tts-${hash}`;
    // Raw headerless mu-law — no WAV container to get subtly wrong, and it's
    // literally the codec (PCMU) AT's trunk uses, so Asterisk needs zero
    // real-time transcoding to play it either.
    const ulawPath = path.join(SOUNDS_DIR, `tts-${hash}.ulaw`);

    // A zero/near-zero-byte file (a crash or kill mid-write, disk-full, etc.)
    // is an unambiguous sign the previous synthesis never actually finished
    // — existsSync alone would trust it forever otherwise. Not a general
    // audio-quality check (that needs Asterisk's own playback outcome, see
    // invalidate() below) — just catching the one failure mode a file-size
    // floor can catch cheaply.
    try {
        if (fs.statSync(ulawPath).size > 200) return soundName;
    } catch {
        // ENOENT — no cached file yet, fall through to synthesize.
    }

    if (inFlight.has(hash)) {
        await inFlight.get(hash);
        return soundName;
    }

    const rawPath = path.join('/tmp', `tts-${hash}-raw.wav`);

    const synthesisPromise = (async () => {
        await run(PIPER_BIN, ['--model', voiceModel, '--length_scale', String(speedScale), '--output_file', rawPath], text);
        await run('sox', [rawPath, '-r', '8000', '-c', '1', '-e', 'mu-law', '-t', 'ul', ulawPath]);
        fs.unlinkSync(rawPath);
    })();

    inFlight.set(hash, synthesisPromise);
    try {
        await synthesisPromise;
    } finally {
        inFlight.delete(hash);
    }

    return soundName;
}

// Piper/sox occasionally produce a "successful" (zero exit code, plausible
// file size) but garbled result — exit-code checking alone doesn't catch
// this, and since synthesize() only checks fs.existsSync, a bad file just
// gets replayed forever for every future request of the same text. This
// lets the ARI app's own playback-outcome check (the only thing that can
// actually tell good audio from bad) force a fresh synthesis next time.
function invalidate(text, { voiceKey, speedScale = 1.0 } = {}) {
    const hash = crypto
        .createHash('sha256')
        .update(`${voiceKey || 'default'}|${speedScale}|${text}`)
        .digest('hex')
        .slice(0, 16);
    const ulawPath = path.join(SOUNDS_DIR, `tts-${hash}.ulaw`);
    fs.unlink(ulawPath, () => {});
}

module.exports = { synthesize, invalidate };
