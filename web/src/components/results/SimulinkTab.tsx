import { AlertTriangle, Boxes, CheckCircle2, CircleAlert, Cpu, Info, MonitorPlay, Play, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import type { SimulinkView } from "../../lib/types";
import { refreshAnalysis, useAnalysis } from "../../lib/useAnalysis";
import { cn, duration, labelOf } from "../../lib/utils";
import { ImageViewer } from "../ui/ImageViewer";
import { Badge, Button, EmptyState, Spinner } from "../ui/primitives";
import { DownloadLink, Panel, Table, type TabProps } from "./shared";
import { WaveformChart } from "./WaveformChart";

const fmt = (x: number) => {
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(3);
  return Number(x.toPrecision(4)).toString();
};

function CheckLine({ line }: { line: string }) {
  const [kind, ...rest] = line.split(" ");
  const text = rest.join(" ");
  const icon =
    kind === "PASS" ? <CheckCircle2 className="size-4 text-ok" /> : kind === "FAIL" ? <XCircle className="size-4 text-err" /> : <Info className="size-4 text-info" />;
  return (
    <li className="flex items-start gap-2.5 px-3.5 py-2 text-[12.5px]">
      <span className="mt-px shrink-0">{icon}</span>
      <Badge tone={kind === "PASS" ? "ok" : kind === "FAIL" ? "err" : "info"} className="mt-px w-10 justify-center">{kind}</Badge>
      <span className="font-mono leading-relaxed text-muted">{text}</span>
    </li>
  );
}

export function SimulinkTab({ service, analysis, tall }: TabProps) {
  const { toast, backend } = useStore();
  // MATLAB opens on the server PC's screen, so only that PC can ask for it (the server refuses others too).
  const remote = backend.status === "online" && !!backend.health.remote;
  const { sim, setSim } = useAnalysis(service, analysis.id);
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!sim) service.getSimulink(analysis.id).then(setSim).catch((e: Error) => setErr(e.message));
  }, [analysis.id, service, setSim, sim]);
  useEffect(() => {
    if (sim?.status !== "running") return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [sim?.status]);

  const generate = async () => {
    setStarting(true);
    setErr(null);
    try {
      setSim(await service.startSimulink(analysis.id));
      await refreshAnalysis(service, analysis.id);
      toast("Simulink model build started", "info");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const openMatlab = async () => {
    setOpening(true);
    setErr(null);
    try {
      await service.openInMatlab(analysis.id);
      toast("MATLAB is starting: the model opens and runs in about 30 seconds", "ok");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      // MATLAB takes a while to appear; keep the button busy so it is not launched twice.
      window.setTimeout(() => setOpening(false), 8000);
    }
  };

  if (!sim) return <div className="flex h-40 items-center justify-center text-muted"><Spinner /></div>;
  const live = service.mode === "live";
  const canBuild = live ? sim.matlab_available : true;
  const files = analysis.files.filter((f) => f.origin === "simulink");
  const slx = files.find((f) => f.name.endsWith(".slx"));

  const header = (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2"><Cpu className="size-5 text-accent" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          Simulink / Simscape model
          <StatusBadge sim={sim} />
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-muted">
          {sim.status === "running" ? `${sim.phase} · ${duration(sim.started, null)}` : sim.status === "done" ? `${sim.model}.slx · ${sim.blocks.length} blocks · ground ${sim.ground ?? "—"}` : live && !sim.matlab_available ? "MATLAB was not found on the analysis server." : "Built with MATLAB R2025b: every read value entered, then simulated and checked against a hand calculation."}
        </div>
      </div>
      {sim.status === "done" && remote && slx && (
        // Visitors over the internet cannot see the analysis PC's screen: hand them the model instead.
        <a href={service.fileUrl(analysis.id, slx.name)} download title="Open it in your own MATLAB (Simscape Electrical)"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-strong">
          <MonitorPlay className="size-4" />Download model (.slx)
        </a>
      )}
      {sim.status === "done" && !remote && (
        <Button
          variant={sim.stale ? "secondary" : "primary"}
          icon={<MonitorPlay className="size-4" />}
          loading={opening}
          disabled={!live}
          title={live ? "Opens MATLAB on the PC running the server, shows the model and runs it" : "Needs the local server (Live mode)"}
          onClick={openMatlab}
        >
          Open in MATLAB
        </Button>
      )}
      {sim.status !== "running" && (
        <Button
          variant={sim.status === "done" ? "secondary" : "primary"}
          icon={sim.status === "idle" ? <Play className="size-4" /> : <RefreshCw className="size-4" />}
          loading={starting}
          disabled={!canBuild}
          title={canBuild ? undefined : "MATLAB is not available"}
          onClick={generate}
        >
          {sim.status === "idle" ? "Generate model" : "Rebuild model"}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {header}
      {err && <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--err),transparent_70%)] bg-err-soft px-3.5 py-2.5 text-[12.5px] text-err"><CircleAlert className="mt-0.5 size-4 shrink-0" />{err}</div>}
      {sim.stale && sim.status !== "running" && (
        <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--warn),transparent_70%)] bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />The components were edited after this model was built. {live ? "Rebuild it to include the changes." : "Demo mode cannot rebuild it."}
        </div>
      )}

      {sim.status === "idle" && (
        <EmptyState icon={<Boxes />} title="No model generated yet">
          {live ? "Check the components and connections first, then generate. It takes a minute or two while MATLAB builds and simulates the model." : "Demo mode loads the model saved from a real MATLAB run of this sample."}
        </EmptyState>
      )}

      {sim.status === "running" && (
        <Panel title={<span className="flex items-center gap-2"><Spinner className="text-accent" />{sim.phase}</span>}>
          <pre className="max-h-60 overflow-auto p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">{sim.log.length ? sim.log.join("\n") : "Starting…"}</pre>
        </Panel>
      )}

      {sim.status === "error" && sim.error && (
        <Panel title={<span className="flex items-center gap-1.5 text-err"><XCircle className="size-4" />Model build failed</span>}>
          <pre className="max-h-72 overflow-auto p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">{sim.error}</pre>
        </Panel>
      )}

      {sim.status === "done" && (
        <Panel
          title="Simulation waveforms"
          actions={<span className="text-[12px] text-faint">{sim.waveforms ? "node voltages from the Simscape run in MATLAB · hover to read values" : ""}</span>}
        >
          {sim.waveforms && sim.waveforms.t.length > 1 && sim.waveforms.series.length ? (
            <div className="p-3"><WaveformChart data={sim.waveforms} /></div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 p-3.5 text-[12.5px] text-muted">
              This model was built before waveforms were saved. Rebuild it to see the scope traces here.
              {canBuild && <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} loading={starting} onClick={generate}>Rebuild model</Button>}
            </div>
          )}
        </Panel>
      )}

      {sim.status === "done" && (
        <div className={cn("grid gap-3", tall && "xl:grid-cols-2")}>
          <Panel title="Simulation check" actions={<span className="text-[12px] text-faint">simulated vs. independent hand calculation</span>}>
            <ul className="divide-y divide-line">{sim.check.map((l, i) => <CheckLine key={i} line={l} />)}</ul>
          </Panel>

          {sim.preview ? (
            <Panel title="Model diagram" actions={<span className="text-[12px] text-faint">{sim.model}</span>}>
              <div className="p-2"><ImageViewer src={`${service.fileUrl(analysis.id, `${sim.model}.png`)}?v=${sim.ended ?? ""}`} alt="Simulink model" className="h-[300px]" /></div>
            </Panel>
          ) : (
            <Panel title="Model diagram"><p className="p-3.5 text-[12.5px] text-muted">No diagram picture was saved for this build. Open the .slx in MATLAB to see it.</p></Panel>
          )}

          {sim.results?.ok && (
            <Panel title="Simulated values">
              <Table className="max-h-[320px]" head={<><th>Part / node</th><th className="text-right">Voltage</th><th className="text-right">Current</th><th className="text-right">Range (last period)</th></>}>
                {sim.results.parts.map((p) => (
                  <tr key={p.name}>
                    <td className="font-mono font-semibold">{p.name}</td>
                    <td className="text-right font-mono tabular">{fmt(p.v_final)} V</td>
                    <td className="text-right font-mono tabular">{fmt(p.i_final)} A</td>
                    <td className="text-right font-mono text-[12px] tabular text-faint">{fmt(p.v_min)} … {fmt(p.v_max)} V</td>
                  </tr>
                ))}
                {sim.results.nodes.map((n) => (
                  <tr key={`n-${n.name}`}>
                    <td className="font-mono text-muted">V({n.name})</td>
                    <td className="text-right font-mono tabular">{fmt(n.final)} V</td>
                    <td />
                    <td className="text-right font-mono text-[12px] tabular text-faint">{fmt(n.min)} … {fmt(n.max)} V</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}

          <Panel title="Blocks">
            <Table className="max-h-[320px]" head={<><th>Block</th><th>Kind</th><th>Value</th><th>Nets</th></>}>
              {sim.blocks.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono font-semibold">{b.id}</td>
                  <td className="text-muted">{labelOf(b.kind)}</td>
                  <td className="font-mono">{b.value || "—"}</td>
                  <td className="font-mono text-[12px] text-muted">{b.nets.join(" · ")}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
      )}

      {(sim.assumed.length > 0 || sim.issues.length > 0) && sim.status !== "idle" && (
        <Panel title="Modelling notes">
          <ul className="divide-y divide-line text-[12.5px]">
            {sim.issues.map((x, i) => <li key={`i${i}`} className="flex gap-2 px-3.5 py-2 text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span className="text-muted">{x}</span></li>)}
            {sim.assumed.map((x, i) => <li key={`a${i}`} className="flex gap-2 px-3.5 py-2"><Info className="mt-0.5 size-3.5 shrink-0 text-info" /><span className="text-muted">Assumed: {x}</span></li>)}
          </ul>
        </Panel>
      )}

      {files.length > 0 && sim.status !== "running" && (
        <div className="flex flex-wrap gap-2">
          {slx && <DownloadLink href={service.fileUrl(analysis.id, slx.name)} className="!border-[color-mix(in_oklab,var(--accent),transparent_60%)] !bg-accent-soft">Simulink model (.slx)</DownloadLink>}
          {files.filter((f) => f !== slx && !f.name.endsWith(".png")).map((f) => (
            <DownloadLink key={f.name} href={service.fileUrl(analysis.id, f.name)}>{f.name}</DownloadLink>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ sim }: { sim: SimulinkView }) {
  if (sim.status === "running") return <Badge tone="accent">building</Badge>;
  if (sim.status === "error") return <Badge tone="err">failed</Badge>;
  if (sim.status === "idle") return <Badge>not built</Badge>;
  if (sim.stale) return <Badge tone="warn">out of date</Badge>;
  const fails = sim.check.filter((l) => l.startsWith("FAIL")).length;
  return fails ? <Badge tone="warn">{fails} check{fails > 1 ? "s" : ""} failed</Badge> : <Badge tone="ok">simulated</Badge>;
}
