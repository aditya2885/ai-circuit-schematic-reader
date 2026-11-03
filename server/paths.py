"""Project paths, shared by the server modules. Importing this puts the reader and the Simulink builder on
sys.path, so their own functions are used unchanged."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READER_SCRIPTS = ROOT / "context" / "schematic-reader" / "scripts"
SIMULINK = ROOT / "simulink"
DATA = Path(os.environ.get("SR_DATA_DIR", ROOT / "server_data"))
UPLOADS = DATA / "uploads"
ANALYSES = DATA / "analyses"
WEB_DIST = ROOT / "web" / "dist"

for p in (READER_SCRIPTS, SIMULINK):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
for p in (UPLOADS, ANALYSES):
    p.mkdir(parents=True, exist_ok=True)
