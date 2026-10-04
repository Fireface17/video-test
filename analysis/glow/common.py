"""Paths shared by the Glowing In The Dark analysis scripts."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
AUDIO = ROOT / "audio" / "glowing-in-the-dark.mp3"
DATA = ROOT / "data" / "glow"
MODELS = ROOT / "analysis" / ".cache" / "models"
WORK = HERE / "work"  # decoded audio, stems, emissions (not in the repo)
QA = HERE / "qa"  # plots (not in the repo)

for d in (DATA, WORK, QA):
    d.mkdir(parents=True, exist_ok=True)
