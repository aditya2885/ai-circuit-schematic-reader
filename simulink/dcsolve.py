"""Independent hand-calculation check: DC steady state by modified nodal analysis.

Capacitors are open, inductors are shorts, sources are ideal. Circuits with semiconductors or lamps are
non-linear and are not solved here (the build reports that instead).
"""
LINEAR = {"resistor", "capacitor", "inductor", "dc_voltage", "dc_current"}


def solve_dc(sim: dict) -> dict[str, float] | None:
    """Node voltages relative to the ground net, or None if the circuit is not linear DC."""
    parts = sim["parts"]
    if not parts or any(p["kind"] not in LINEAR for p in parts):
        return None
    ground = sim["ground"]
    nodes = sorted({n for p in parts for n in p["nets"][:2]} - {ground})
    idx = {n: i for i, n in enumerate(nodes)}
    vsrc = [p for p in parts if p["kind"] in ("dc_voltage", "inductor")]  # inductor = 0 V source
    size = len(nodes) + len(vsrc)
    A = [[0.0] * size for _ in range(size)]
    b = [0.0] * size

    def stamp_g(n1, n2, g):
        for x, y, s in ((n1, n1, g), (n2, n2, g), (n1, n2, -g), (n2, n1, -g)):
            if x in idx and y in idx:
                A[idx[x]][idx[y]] += s

    for p in parts:
        n1, n2 = p["nets"][0], p["nets"][1]
        if p["kind"] == "resistor":
            stamp_g(n1, n2, 1 / p["params"]["R"])
        elif p["kind"] == "dc_current":  # current i0 flows from + through the source to - externally... drive n1
            if n1 in idx:
                b[idx[n1]] += p["params"]["i0"]
            if n2 in idx:
                b[idx[n2]] -= p["params"]["i0"]
    for k, p in enumerate(vsrc):
        row = len(nodes) + k
        n1, n2 = p["nets"][0], p["nets"][1]
        for n, s in ((n1, 1.0), (n2, -1.0)):
            if n in idx:
                A[row][idx[n]] += s
                A[idx[n]][row] += s
        b[row] = p["params"]["v0"] if p["kind"] == "dc_voltage" else 0.0
    x = _gauss(A, b)
    return None if x is None else {n: x[i] for n, i in idx.items()} | {ground: 0.0}


def _gauss(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[piv][c]) < 1e-15:
            return None  # floating node: not solvable
        M[c], M[piv] = M[piv], M[c]
        for r in range(n):
            if r != c and M[r][c]:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * bb for a, bb in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]
