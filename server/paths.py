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

# Secret that marks the analysis PC's own browser when it comes in through the public tunnel (so it may open
# MATLAB on this screen). Created once; Start-Public.bat hands it to the browser in the page link's #fragment.
OWNER_KEY_FILE = DATA / "owner.key"
if not OWNER_KEY_FILE.exists():
    import secrets
    OWNER_KEY_FILE.write_text(secrets.token_urlsafe(24), encoding="ascii")
OWNER_KEY = OWNER_KEY_FILE.read_text(encoding="ascii").strip()
