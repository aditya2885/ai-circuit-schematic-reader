"""Ruled-paper removal: erase the printed lines of notebook paper before a hand-drawn circuit is read.

On lined paper every ruled line looks like a wire to the tracer (it joins everything it touches into one
net) and clutters the image the model sees. Ruled lines differ from drawn wires in four ways, and all
four must hold before anything is erased:
1. long: each runs (nearly) from one edge of the photo to the other,
2. straight and nearly horizontal: within a few degrees, allowing a gentle curl of the page,
3. evenly spaced: at least three of them, at a regular pitch,
4. thin: printed lines are finer than a pen stroke.
Only the thin parts of a line are erased. Where a drawn wire crosses it or runs along it, the ink there is
thicker than the printed line alone, so it is kept and the drawing is not cut.
"""
from PIL import Image

INK = 40              # darkness above the local paper that counts as ink
DETECT_WIDTH = 400    # lines are found on a copy this wide, then followed at full size
SLOPES = [i * 0.004 for i in range(-15, 16)]  # about +-3.5 degrees
MIN_COVER = 0.6       # a candidate's straight-line fit must cover this much of the width
MIN_SPAN = 0.75       # a followed line must be found in this fraction of the columns
MIN_LINES = 3
PITCH_TOL = 0.25      # gaps within this fraction of the typical gap count as regular


def _candidates(ink: Image.Image) -> list[tuple[float, float]]:
    """(y at the centre column, slope) of every row that a straight, nearly horizontal line covers well."""
    W, H = ink.size
    f = min(1.0, DETECT_WIDTH / W)
    w, h = max(1, round(W * f)), max(1, round(H * f))
    small = ink.resize((w, h), Image.BOX).point(lambda v: 255 if v > 30 else 0)  # thin lines survive at 30
    data = small.tobytes()
    cols = [[y for y in range(h) if data[y * w + x]] for x in range(w)]
    best, slope = [0] * h, [0.0] * h
    for k in SLOPES:
        cover = [0] * h
        for x, ys in enumerate(cols):
            shift = round(k * (x - w / 2))
            hit = {y - shift + d for y in ys for d in (-1, 0, 1)}  # +-1 row: a line is not quite straight
            for r in hit:
                if 0 <= r < h:
                    cover[r] += 1
        for r in range(h):
            if cover[r] > best[r]:
                best[r], slope[r] = cover[r], k
    out = []
    for r in range(h):
        if best[r] >= MIN_COVER * w and best[r] == max(best[max(0, r - 3):r + 4]) \
                and not (out and r - out[-1][0] <= 3):
            out.append((r, slope[r]))
    return [(r / f, k) for r, k in out]


def _follow(px, W, H, yc: float, k: float) -> list[tuple[int, int, int]]:
    """Follow a line from the centre column outwards. Returns (x, top, bottom) of the ink run it passes
    through in each column where one was found. The predicted row drifts with the run centres, so a
    curled page is followed too; thick runs (a drawn wire on the line) do not move it."""
    win = max(4, round(0.006 * max(W, H)))
    thin = max(3, round(0.006 * max(W, H)))
    runs = []
    for xs in (range(W // 2, W), range(W // 2 - 1, -1, -1)):
        off = 0.0
        for x in xs:
            base = yc + k * (x - W / 2)
            yp = base + off
            best = None
            y = max(0, int(yp - win))
            while y <= min(H - 1, int(yp + win)):
                if px[x, y]:
                    s = y
                    while s > 0 and px[x, s - 1]:
                        s -= 1
                    e = y
                    while e < H - 1 and px[x, e + 1]:
                        e += 1
                    d = abs((s + e) / 2 - yp)
                    if best is None or d < best[0]:
                        best = (d, s, e)
                    y = e + 1
                else:
                    y += 1
            if best:
                _, s, e = best
                runs.append((x, s, e))
                if e - s + 1 <= thin:
                    off = 0.7 * off + 0.3 * ((s + e) / 2 - base)
    return runs


def find_ruled_lines(strength: Image.Image) -> list[list[tuple[int, int, int]]]:
    """The pixel runs to erase, one list per ruled line, or [] if the image is not on ruled paper.
    `strength` is how much darker each pixel is than the local paper (0 = paper)."""
    ink = strength.point(lambda v: 255 if v > INK else 0)
    W, H = ink.size
    px = ink.load()
    lines = []
    for yc, k in _candidates(ink):
        runs = _follow(px, W, H, yc, k)
        if len(runs) < MIN_SPAN * W:
            continue
        lengths = sorted(e - s + 1 for _, s, e in runs)
        t = lengths[len(lengths) // 2]  # the printed line's own thickness: most columns are only line
        if t > 0.01 * max(W, H) + 2:
            continue  # too thick for a printed line
        limit = max(t + 2, round(1.6 * t))
        centre = sum((s + e) / 2 for _, s, e in runs) / len(runs)
        lines.append((centre, [(x, s, e) for x, s, e in runs if e - s + 1 <= limit]))
    lines.sort()
    # Two follows can lock onto the same line from neighbouring candidates; keep one.
    unique = [l for i, l in enumerate(lines) if i == 0 or l[0] - lines[i - 1][0] > 3]
    if len(unique) < MIN_LINES:
        return []
    gaps = [b[0] - a[0] for a, b in zip(unique, unique[1:])]
    pitch = sorted(gaps)[len(gaps) // 2]
    regular = sum(1 for g in gaps if abs(g - pitch) <= PITCH_TOL * pitch)
    if regular < max(2, len(gaps) / 2):
        return []  # long horizontal strokes, but not an evenly ruled page
    return [runs for _, runs in unique]


def remove_ruled_lines(strength: Image.Image) -> tuple[Image.Image, int]:
    """`strength` with the ruled lines set to paper (0), and how many lines were erased. A page photographed
    sideways has its lines running vertically: those are found on the image turned a quarter."""
    out, n = _remove(strength)
    if n:
        return out, n
    out, n = _remove(strength.transpose(Image.Transpose.TRANSPOSE))
    return (out.transpose(Image.Transpose.TRANSPOSE), n) if n else (strength, 0)


def _remove(strength: Image.Image) -> tuple[Image.Image, int]:
    lines = find_ruled_lines(strength)
    if not lines:
        return strength, 0
    W, H = strength.size
    data = bytearray(strength.tobytes())
    for runs in lines:
        for x, s, e in runs:
            for y in range(max(0, s - 2), min(H, e + 3)):  # two pixels more each side: the soft edge
                data[y * W + x] = 0
    return Image.frombytes("L", (W, H), bytes(data)), len(lines)
