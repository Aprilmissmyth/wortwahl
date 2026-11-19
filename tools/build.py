"""Build the game's data files and word audio.

Reads data/words.json, data/rules.json and data/voices.json. For every word and
rule item it synthesises one short clip per voice with Piper (nouns are spoken
with their article, e.g. "der Tisch"), encodes it as a small mono MP3 under
audio/<voice id>/, and writes js/words.js and js/rules.js, which the page loads
with plain <script> tags.

Usage:
  python tools/build.py --voices-dir DIR [--force] [--prune]
      DIR holds the Piper models named in data/voices.json (<model>.onnx + .onnx.json)
  python tools/build.py --no-audio      only regenerate js/words.js and js/rules.js

Requires: piper-tts, av, numpy (see tools/requirements.txt).
"""
import argparse
import io
import json
import re
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "words.json"
RULES = ROOT / "data" / "rules.json"
VOICES = ROOT / "data" / "voices.json"
AUDIO_DIR = ROOT / "audio"
OUT_JS = ROOT / "js" / "words.js"
OUT_RULES_JS = ROOT / "js" / "rules.js"
ARTICLES = {"m": "der", "f": "die", "n": "das"}
LEAD, TAIL = 0.12, 0.20   # seconds of silence around each clip
BITRATE = 48000


def spoken_form(word):
    if word["pos"] == "noun":
        return f'{ARTICLES[word["gender"]]} {word["de"]}'
    return word["de"]


def rule_spoken_form(item):
    if item.get("article"):          # plural forms: "die Blumen"
        return f'{item["article"]} {item["de"]}'
    return f'{ARTICLES[item["gender"]]} {item["de"]}' if item.get("gender") else item["de"]


def slug(text):
    text = text.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def rule_items(rules):
    for lesson in rules["lessons"]:
        for item in lesson["examples"] + lesson["tests"]:
            yield lesson, item


def synthesize(voice, text):
    from piper import SynthesisConfig
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        voice.synthesize_wav(text + ".", out, syn_config=SynthesisConfig(length_scale=1.0))
    buffer.seek(0)
    with wave.open(buffer, "rb") as src:
        return src.getframerate(), src.readframes(src.getnframes())


def encode_mp3(rate, pcm, path):
    import av
    import numpy as np
    samples = np.frombuffer(pcm, dtype=np.int16)
    silence = lambda sec: np.zeros(int(rate * sec), dtype=np.int16)
    samples = np.concatenate([silence(LEAD), samples, silence(TAIL)])
    with av.open(str(path), "w", format="mp3") as container:
        stream = container.add_stream("libmp3lame", rate=rate, layout="mono")
        stream.bit_rate = BITRATE
        fifo = av.AudioFifo()
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = rate
        fifo.write(frame)
        size = stream.codec_context.frame_size or 1152
        while fifo.samples >= size:
            for packet in stream.encode(fifo.read(size)):
                container.mux(packet)
        rest = fifo.read()
        if rest is not None:
            for packet in stream.encode(rest):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voices-dir", help="folder with the Piper models named in data/voices.json")
    parser.add_argument("--force", action="store_true", help="re-synthesise clips that already exist")
    parser.add_argument("--prune", action="store_true", help="delete clips no longer used by any word")
    parser.add_argument("--no-audio", action="store_true", help="only rebuild js/words.js and js/rules.js")
    args = parser.parse_args()

    data = json.loads(DATA.read_text(encoding="utf-8"))
    rules = json.loads(RULES.read_text(encoding="utf-8")) if RULES.exists() else None
    voices = json.loads(VOICES.read_text(encoding="utf-8"))
    if not voices or len({v["id"] for v in voices}) != len(voices):
        raise SystemExit("data/voices.json must list at least one voice, with unique ids")

    ids = [w["id"] for w in data["words"]]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate word ids in data/words.json")
    meanings = [w["zh"] for w in data["words"]]
    if len(meanings) != len(set(meanings)):
        raise SystemExit("two words share the same Chinese meaning; the two options could look identical")

    # Every clip as (file name, text to speak). Item "audio" fields hold the file name only;
    # the page puts audio/<voice id>/ in front of it.
    clips = {}
    for word in data["words"]:
        word["audio"] = f'{word["id"]}.mp3'
        clips[word["audio"]] = spoken_form(word)
    if rules:
        lesson_ids = [l["id"] for l in rules["lessons"]]
        if len(lesson_ids) != len(set(lesson_ids)):
            raise SystemExit("duplicate lesson ids in data/rules.json")
        for lesson, item in rule_items(rules):
            if item.get("gender") and item["gender"] not in ARTICLES:
                raise SystemExit(f'bad gender in lesson {lesson["id"]}: {item["de"]}')
            spoken = rule_spoken_form(item)
            item["audio"] = f"r-{slug(spoken)}.mp3"
            clips[item["audio"]] = spoken

    made = 0
    if not args.no_audio:
        from piper import PiperVoice
        for v in voices:
            out_dir = AUDIO_DIR / v["id"]
            out_dir.mkdir(parents=True, exist_ok=True)
            todo = [(name, text) for name, text in clips.items() if args.force or not (out_dir / name).exists()]
            if todo:
                if not args.voices_dir:
                    raise SystemExit("--voices-dir is required to synthesise audio")
                model = Path(args.voices_dir) / f'{v["model"]}.onnx'
                if not model.exists():
                    raise SystemExit(f"voice model not found: {model}")
                piper_voice = PiperVoice.load(str(model))
                for name, text in todo:
                    rate, pcm = synthesize(piper_voice, text)
                    encode_mp3(rate, pcm, out_dir / name)
                    made += 1
            unused = [f for f in out_dir.glob("*.mp3") if f.name not in clips]
            if unused and args.prune:
                for f in unused:
                    f.unlink()
            elif unused:
                print(f'voice {v["id"]}: {len(unused)} unused clips (run with --prune to delete)')

    data["voices"] = [{"id": v["id"], "label": v["label"]} for v in voices]
    OUT_JS.parent.mkdir(exist_ok=True)
    OUT_JS.write_text("// Generated by tools/build.py from data/words.json. Do not edit by hand.\n"
                      "window.WORDLIST = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n",
                      encoding="utf-8")
    if rules:
        OUT_RULES_JS.write_text("// Generated by tools/build.py from data/rules.json. Do not edit by hand.\n"
                                "window.RULES = " + json.dumps(rules, ensure_ascii=False, indent=1) + ";\n",
                                encoding="utf-8")
    total = sum(f.stat().st_size for f in AUDIO_DIR.rglob("*.mp3"))
    print(f"{len(data['words'])} words, {len(clips)} distinct clips x {len(voices)} voices, "
          f"{made} synthesised, audio total {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
