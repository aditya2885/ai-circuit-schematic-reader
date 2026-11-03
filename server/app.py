"""Web API for AI Circuit Schematic Reader.

    python server/app.py                 # http://127.0.0.1:8000  (API under /api, the built web app at /)

Frontend -> this API -> analyze.py (Qwen3-VL via Ollama) -> structured circuit JSON -> simulink builder (MATLAB).
Settings come from environment variables: SR_HOST, SR_PORT, SR_CORS_ORIGINS (comma-separated), SR_DATA_DIR.
"""
import io
import json
import os
import secrets
import sys
import uuid
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ollama  # noqa: E402
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from PIL import Image, ImageOps, UnidentifiedImageError  # noqa: E402
from pydantic import BaseModel, Field, ValidationError  # noqa: E402

from paths import OWNER_KEY, UPLOADS, WEB_DIST  # noqa: E402
import chat  # noqa: E402
import circuit  # noqa: E402
import pipeline  # noqa: E402

MAX_UPLOAD = 25 * 1024 * 1024
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/bmp": ".bmp"}
VERSION = "1.0.0"

app = FastAPI(title="AI Circuit Schematic Reader API", version=VERSION)
# allow_private_network: the hosted site (GitHub Pages, https) talks to this server on 127.0.0.1, and Chrome
# sends a Private Network Access preflight first; without this the preflight is rejected with 400.
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("SR_CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"], allow_private_network=True)
pipeline.recover()


def _remote(request: Request) -> bool:
    """True for visitors coming through the public tunnel (Start-Public.bat), whose requests reach this
    server from cloudflared on 127.0.0.1 but carry the visitor's address in these headers."""
    return "cf-connecting-ip" in request.headers or "x-forwarded-for" in request.headers


def _owner(request: Request) -> bool:
    """The analysis PC's own browser: a direct local request, or one carrying the owner key through the
    tunnel. Only the owner may open MATLAB on this PC's screen."""
    key = request.headers.get("x-owner-key", "")
    return not _remote(request) or (bool(key) and secrets.compare_digest(key, OWNER_KEY))


def _job(job_id: str) -> dict:
    job = pipeline.get(job_id) if job_id.isalnum() else None
    if job is None:
        raise HTTPException(404, "No such analysis.")
    return job


def _require_result(job_id: str) -> dict:
    _job(job_id)
    view = circuit.view(pipeline.folder(job_id))
    if view is None:
        raise HTTPException(409, "This analysis has no result yet.")
    return view


# ---------------------------------------------------------------- health

@app.get("/api/health")
def health(request: Request):
    try:
        models = sorted(m.model for m in ollama.Client().list().models)
        ollama_ok, ollama_error = True, None
    except Exception as err:   # Ollama not running or unreachable
        models, ollama_ok, ollama_error = [], False, str(err)
    return {"ok": True, "version": VERSION,
            "ollama": {"ok": ollama_ok, "models": models, "error": ollama_error},
            "matlab": {"ok": pipeline.matlab_available(), "path": pipeline.MATLAB},
            "remote": _remote(request), "owner": _owner(request)}


# ---------------------------------------------------------------- uploads

@app.post("/api/uploads")
async def upload(file: UploadFile = File(...), source_name: str | None = Form(None)):
    ext = IMAGE_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(415, "Upload a JPG, PNG, WEBP or BMP image (PDFs are converted to an image in the browser).")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "The file is larger than 25 MB.")
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        width, height = im.size
    except (UnidentifiedImageError, OSError):
        raise HTTPException(415, "The file is not a readable image.")
    uid = uuid.uuid4().hex[:12]
    (UPLOADS / f"{uid}{ext}").write_bytes(data)
    meta = {"id": uid, "name": source_name or file.filename or f"schematic{ext}", "size": len(data),
            "width": width, "height": height, "type": file.content_type, "url": f"/api/uploads/{uid}"}
    (UPLOADS / f"{uid}.meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


@app.get("/api/uploads/{upload_id}")
def get_upload(upload_id: str):
    p = next((p for p in UPLOADS.glob(f"{upload_id}.*") if p.suffix != ".json"), None) if upload_id.isalnum() else None
    if p is None:
        raise HTTPException(404, "No such upload.")
    return FileResponse(p)


# ---------------------------------------------------------------- analyses

class AnalysisRequest(BaseModel):
    upload_id: str
    model: str = "qwen3-vl:8b-instruct"
    box_model: str | None = None
    max_side: int = Field(1600, ge=400, le=4000)
    simulink: bool = True


def _analysis_payload(job: dict) -> dict:
    return job | {"result": circuit.view(pipeline.folder(job["id"])), "files": pipeline.files(job["id"]),
                  "matlab_available": pipeline.matlab_available()}


@app.post("/api/analyses", status_code=201)
def create_analysis(req: AnalysisRequest):
    if not req.upload_id.isalnum():
        raise HTTPException(400, "Bad upload id.")
    try:
        job = pipeline.start_analysis(req.upload_id, req.model_dump(exclude={"upload_id"}))
    except FileNotFoundError:
        raise HTTPException(404, "Upload not found; upload the image again.")
    return _analysis_payload(job)


@app.get("/api/analyses")
def list_analyses():
    return pipeline.list_jobs()


@app.get("/api/analyses/{job_id}")
def get_analysis(job_id: str):
    return _analysis_payload(_job(job_id))


@app.get("/api/analyses/{job_id}/components")
def get_components(job_id: str):
    return _require_result(job_id)["components"]


class ComponentsUpdate(BaseModel):
    components: list[dict]


@app.put("/api/analyses/{job_id}/components")
def put_components(job_id: str, body: ComponentsUpdate):
    job = _job(job_id)
    _require_result(job_id)
    cleaned = [{k: v for k, v in c.items() if k != "evidence"} for c in body.components]
    try:
        circuit.save_components(pipeline.folder(job_id), cleaned, job["file"]["name"])
    except ValidationError as err:
        raise HTTPException(422, f"Invalid component data: {err.errors()[0]['msg']}")
    pipeline.mark_stale(job_id)
    return _analysis_payload(pipeline.get(job_id))


@app.get("/api/analyses/{job_id}/connections")
def get_connections(job_id: str):
    return _require_result(job_id)["connections"]


@app.get("/api/analyses/{job_id}/netlist", response_class=PlainTextResponse)
def get_netlist(job_id: str):
    return _require_result(job_id)["netlist"]


@app.get("/api/analyses/{job_id}/bom")
def get_bom(job_id: str):
    return _require_result(job_id)["bom"]


@app.post("/api/analyses/{job_id}/simulink", status_code=202)
def build_model(job_id: str):
    _job(job_id)
    try:
        pipeline.start_simulink(job_id)
    except RuntimeError as err:
        raise HTTPException(409, str(err))
    return pipeline.simulink_view(job_id)


@app.post("/api/analyses/{job_id}/simulink/open", status_code=202)
def open_model(job_id: str, request: Request):
    _job(job_id)
    if not _owner(request):
        raise HTTPException(403, "MATLAB opens on the PC running the server, so only that PC can open it. "
                                 "Download the .slx model from this tab and open it in your own MATLAB.")
    try:
        model = pipeline.open_in_matlab(job_id)
    except RuntimeError as err:
        raise HTTPException(409, str(err))
    return {"ok": True, "model": model}


@app.get("/api/analyses/{job_id}/simulink")
def model_status(job_id: str):
    _job(job_id)
    return pipeline.simulink_view(job_id)


@app.get("/api/analyses/{job_id}/files/{name}")
def download(job_id: str, name: str):
    _job(job_id)
    p = pipeline.file_path(job_id, name)
    if p is None:
        raise HTTPException(404, "No such file.")
    return FileResponse(p, filename=p.name)


@app.get("/api/analyses/{job_id}/bundle.zip")
def bundle(job_id: str):
    _job(job_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in pipeline.files(job_id):
            z.write(pipeline.file_path(job_id, f["name"]), f"{f['origin']}/{f['name']}")
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="analysis_{job_id}.zip"'})


# ---------------------------------------------------------------- chat

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    analysis_id: str | None = None
    history: list[dict] = []
    model: str = "qwen3-vl:8b-instruct"


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest, request: Request):
    job_id = req.analysis_id if req.analysis_id and req.analysis_id.isalnum() else None
    return StreamingResponse(chat.stream(job_id, req.message, req.history, req.model, remote=not _owner(request)),
                             media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- the built web app

if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("SR_HOST", "127.0.0.1"), port=int(os.environ.get("SR_PORT", "8000")))
